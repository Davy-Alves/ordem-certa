# Ordem Certa para Windows — versão 1.0 de homologação

Pacote preparado em 20/10/2026 para Windows x64.

## O que foi entregue

- **Cliente/OrdemCerta.exe**: aplicativo desktop C# / WinForms com WebView2. Mostra as telas do Ordem Certa dentro de uma janela Windows.
- **InstalarCliente.exe**: instala o cliente no perfil do usuário e cria atalhos na Área de Trabalho e no menu Iniciar.
- **Servidor/TMSRV.exe**: inicia o servidor de aplicação, valida sessões, permissões, alterações de registros, conflitos e regras de conclusão/distribuição.
- **Servidor/DBSRV.exe**: inicia o servidor de contas e persistência; valida senhas, mantém sessões e grava a base SQLite.
- **Servidor/data/ordem-certa.sqlite**: cópia migrada dos dados fornecidos.
- **Fontes/** e **Servidor/src/**: código-fonte e compilação.
- **Testes/**: testes de integração, resultado e imagens com dados fictícios.

Os nomes seguem a organização solicitada, inspirada no WYD. Este projeto não contém código nem usa o protocolo de rede do jogo.

```text
PC da equipe                       VPS Windows
OrdemCerta.exe -- HTTPS --> TMSRV.exe -- HTTP interno + chave --> DBSRV.exe
                                                                  |
                                                    SQLite / contas / sessões
                                                                  |
                                                             backups
```

DBSRV e TMSRV foram projetados para funcionar **juntos na mesma VPS**. O DBSRV escuta somente em 127.0.0.1. Separar os dois em máquinas distintas exige uma alteração adicional de transporte e configuração.

## Teste local rápido

1. Extraia todo o pacote para uma pasta local.
2. Execute `Servidor/Iniciar-Local.ps1` com PowerShell. Os executáveis rodam em segundo plano; consulte `Servidor/logs`.
3. Abra `Cliente/OrdemCerta.exe`.
4. Use `http://127.0.0.1:4173` na barra superior e clique em **Conectar**.
5. Entre com uma conta e senha já existentes na base original. Não foi criada senha administrativa padrão.
6. Ao terminar, execute `Servidor/Parar-Local.ps1`.

Também é possível abrir primeiro `DBSRV.exe` e depois `TMSRV.exe` diretamente. Nessa modalidade, mantenha suas janelas abertas.

O cliente requer .NET Framework 4.6.2 ou superior e **Microsoft Edge WebView2 Runtime**. O runtime costuma estar presente em Windows recentes; caso falte, instale pelo [site oficial da Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/). Os servidores incluem seu próprio Node.js; não é necessário instalar Node, npm ou um serviço de banco separado.

## Instalação em cada computador

Distribua **somente `InstalarCliente.exe`** aos usuários. O instalador contém o cliente e suas DLLs.

O programa é instalado em `%LOCALAPPDATA%\Satel\OrdemCerta\Aplicativo`. O endereço do servidor fica no arquivo `%LOCALAPPDATA%\Satel\OrdemCerta\servidor.txt`; o perfil WebView2 fica na pasta `Perfil`.

Ao abrir, informe o endereço real do TMSRV, por exemplo `https://ordemcerta.suaempresa.com.br`.

**Não distribua a pasta Servidor nem o pacote completo para os computadores da equipe:** a pasta do servidor contém a base e a chave interna.

Para desinstalar o cliente, feche-o e remova a pasta `Aplicativo` e os atalhos. A pasta `Perfil` pode conter rascunhos pendentes; exporte-os antes de removê-la.

## Publicação na VPS

1. Use uma VPS Windows x64 com .NET Framework 4.6.2 ou superior. Copie a pasta **Servidor** completa para uma pasta definitiva, por exemplo `C:\OrdemCerta\Servidor`.
2. Aponte o DNS de um domínio para o IP público da VPS.
3. Providencie um certificado HTTPS válido para esse domínio. O pacote não inclui certificado, domínio ou renovação automática de certificado.
4. Coloque a chave privada PEM e a cadeia de certificados PEM em `Servidor/certificados`.
5. Edite `servidor.json`. Use `servidor.exemplo-https.json` como referência, **preservando o valor de `internalKey` do arquivo original**:
   - `tmHost`: `"0.0.0.0"`
   - `tmPort`: `443`
   - `publicUrl`: `"https://seu-dominio"`
   - `tls`: `{"key":"certificados/privkey.pem","cert":"certificados/fullchain.pem"}`
   - mantenha `dbPort` em `4174`.
6. Libere **TCP 443** no firewall Windows e no painel do provedor. Não abra a porta 4174.
7. Execute `Instalar-Servicos.ps1` como administrador. Ele instala `OrdemCertaDBSRV` e `OrdemCertaTMSRV`, com início automático, dependência entre eles e tentativas de reinício após falha.
8. Teste o endereço HTTPS e instale o cliente em um computador externo.

O cliente aceita HTTP apenas em loopback, para testes locais. Para acesso remoto é obrigatório HTTPS com certificado válido; ele não ignora erros de certificado.

Se já existir IIS ou outro serviço usando a porta 443, a integração deverá ser feita com esse serviço ou outra porta HTTPS. Não substitua serviços existentes sem planejar a configuração.

O modo de serviço usa contas virtuais dedicadas do Windows e logs em `Servidor/logs`. A instalação registra serviços e ajusta as permissões de leitura/gravação necessárias. **A instalação como serviço e a exposição pública ainda precisam ser validadas na VPS de destino.** Os executáveis foram testados localmente em modo de processo.

## Dados e migração

A migração foi feita a partir de `orders.json` e `accounts.json`, preservando os arquivos de origem. Conferência:

| Coleção | Registros |
|---|---:|
| Ordens | 1.262 |
| Usuários | 21 |
| Colaboradores | 35 |
| Histórico | 23.640 |
| Distribuições recentes | 50 |

Esta base corresponde aos arquivos enviados. Antes da troca definitiva, interrompa as gravações no sistema antigo e faça uma nova migração da base mais recente para **uma pasta de dados vazia**.

Para migrar outra cópia, configure uma pasta `dataDir` nova em `servidor.json`, pare os servidores e execute:

```powershell
.\runtime\node.exe .\src\migrate.mjs "C:\caminho\da\base-antiga\data"
```

A ferramenta recusa sobrescrever um banco de destino existente. Os hashes de senhas existentes são reconhecidos; após login válido, a credencial é atualizada para PBKDF2 no servidor.

A persistência usa um documento de estado em SQLite com transações, revisão e auditoria técnica. Não é ainda um esquema relacional de uma tabela por entidade. Esse desenho conserva os campos particulares do sistema original e evita perdas na migração; grandes crescimentos de volume podem exigir normalização e paginação.

## Salvamento e trabalho simultâneo

O cliente envia alterações por registro e campo. Alterações em campos diferentes podem ser combinadas. Se duas pessoas alterarem o mesmo campo a partir de uma versão antiga, o segundo salvamento recebe conflito.

O histórico não é mais cortado para 5.000 entradas pelo servidor. Reenvios de uma mesma entrada são reconhecidos pelo ID.

Falhas de salvamento mostram um painel com **Tentar novamente**, **Exportar rascunho** e **Descartar rascunho e atualizar**. Em conflito, exporte o rascunho antes de descartar e reaplique a alteração necessária sobre os dados atualizados. A nova versão não oferece operação offline completa; o rascunho é uma proteção auxiliar e depende do armazenamento disponível no computador.

Os perfis administrativos e operacionais são conferidos no TMSRV. A interface preserva regras e formulários existentes; o TMSRV acrescenta validação de acesso, concorrência, pendências, VOZES e processos na conclusão. Parte das regras de apresentação e preparação de movimentos continua no JavaScript da interface. A homologação deve abranger os perfis reais, especialmente os fluxos excepcionais de processos, adequações e importações.

## Backups e restauração

- O DBSRV faz um backup consistente do SQLite a cada 60 minutos, configurável por `backupMinutes` (mínimo de 5 minutos).
- Para backup imediato, execute `Backup.ps1`; ele verifica a integridade do arquivo criado.
- Os arquivos ficam em `data/backups`. Não há exclusão automática: planeje retenção e cópia para outro local.
- Logs também precisam de retenção operacional.

Para restaurar:

1. Pare os serviços TMSRV e DBSRV, ou os processos de teste.
2. Execute:

```powershell
.\Restaurar.ps1 -Backup "C:\caminho\backup.sqlite"
```

3. O restaurador verifica a integridade, preserva o banco atual com sufixo `antes-restauracao`, copia o backup e invalida sessões.
4. Reinicie DBSRV e TMSRV. Os usuários precisarão entrar novamente.

Evite copiar apenas `ordem-certa.sqlite` com o servidor em execução: pode haver transações no arquivo WAL. Use a ferramenta de backup fornecida.

## Verificação e limites desta entrega

Os testes usam contas e ordens fictícias em pasta temporária; não alteram a base migrada. Foram testados os executáveis dos servidores, login no cliente WebView2 nativo, autenticação, permissões, gravação, conflito, backup, reinício, navegação das telas e exportação de planilhas. Consulte `Testes/resultado.txt`.

Esta é uma **versão executável para homologação**, não uma implantação pública já concluída. Não foram testados todos os modelos reais de planilha, todos os caminhos de processos/adequações nem carga simultânea de toda a equipe. Os executáveis ainda não possuem assinatura digital Authenticode.

Para a entrada em produção, valide uma amostra real de cada fluxo e cada perfil, teste a restauração e confirme o acesso externo à VPS. Mantenha o sistema antigo disponível para retorno durante a homologação.

## Código e recompilação

- Shell desktop e hosts de serviço: C# / .NET Framework.
- TMSRV e DBSRV: JavaScript ESM / Node.js 24.19.0, incluído em `runtime`.
- Interface: HTML/CSS/JavaScript do sistema original, adaptada para autenticação e salvamento por operações.
- WebView2 SDK: 1.0.3537.50.

Os executáveis dos servidores são hosts C# que iniciam o runtime Node incluído. **Copie a pasta Servidor completa**, não apenas os arquivos EXE.

Execute `Fontes/compilar.ps1` para recompilar os hosts, o cliente e o instalador usando o compilador do .NET Framework no Windows. As DLLs do WebView2 em `Cliente` são referências de compilação e dependências de execução.

`Fontes/preparar-interface.mjs` registra a transformação da interface antiga. Ele serve para uma cópia ainda não adaptada dos arquivos originais; não o execute sobre a interface pronta. `Fontes/finalizar-interface.mjs` aplica os ajustes finais de estilo e recuperação.

Para repetir a integração básica:

```powershell
.\Servidor\runtime\node.exe .\Testes\integracao.mjs
```

Os testes de interface opcionais usam Playwright e Edge instalados no ambiente de desenvolvimento. `OC_NATIVE_TEST=1` ativa também o teste do cliente nativo. Os testes selecionam portas locais temporarias disponiveis.

Documentação técnica das dependências: [SQLite no Node.js](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) e [distribuição WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution). As licenças das dependências incluídas estão em `Licencas`.
