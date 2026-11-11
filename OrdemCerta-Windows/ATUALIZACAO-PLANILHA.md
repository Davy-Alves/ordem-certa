# Atualizar Planilha — cabeçalhos de 22/10/2026

O importador aceita os cabeçalhos da planilha atual apresentados na segunda linha do arquivo de referência. Não é necessário reorganizar as colunas de postes e processos para usar o modelo anterior.

- Use a aba `C.I. PROJETOS`, com os cabeçalhos da planilha atual e as ordens nas linhas seguintes.
- A identificação continua sendo feita pela coluna `OS`. Atualizar Planilha atualiza as ordens existentes na base.
- Os campos são localizados pelo nome do cabeçalho, independentemente da posição. Acentos, espaços e pontuação são normalizados.
- `Nº POSTES DO PROJETO` e `Nº POSTES TERMO DE PASSAGEM` passam a ser reconhecidos, junto aos nomes do modelo anterior.
- `REGIÃO`/`REGIONAL`, postes ambientais, paralelismo e travessia não dependem mais de posições fixas. Meses, observações, valoração e temporizadores não são usados como quantidades de postes.
- `DATA FINAL` continua representando a conclusão do CAD; `DATA FINAL CAD` também é aceito. Se os dois cabeçalhos existirem, `DATA FINAL CAD` tem prioridade, inclusive se estiver vazio.
- Em XLSX/XLS, se houver duas linhas consecutivas de cabeçalhos como no arquivo comparativo, o último cabeçalho antes dos dados será usado. Um arquivo contendo somente cabeçalhos não contém ordens para atualizar.
- As regras de validação de responsáveis, processos e conclusão continuam sendo aplicadas. O diagnóstico CSV informa quais colunas foram lidas e quais não são usadas pelo atualizador de status; a presença de uma coluna na planilha não significa que ela atualize um campo do sistema.

O cliente Windows recebe o importador do TMSRV. Abra o cliente ou clique em **Atualizar** na barra superior para carregar a versão corrigida. Não é necessário reinstalar o executável.

## Datas de conclusão dos processos

`DATA AMBIENTAL FINALIZADO` alimenta a data individual do processo Ambiental, e `DATA TRAVESSIA FINALIZADO` alimenta a data individual de Paralelismo e Travessia, também nas atualizações comuns. Uma data não é copiada para outro processo. Datas ausentes não são substituídas pela data de fechamento da OS nem pela data atual. Os demais detalhes já cadastrados são preservados.

Rascunhos gerados antes desta correção precisam ser refeitos pela importação: tentar salvar o mesmo rascunho não recalcula seus campos. Exporte o rascunho antes de descartá-lo se ele contiver alterações que precisam ser preservadas. Reimporte somente após carregar a versão corrigida.

Uma OS inválida bloqueia o lote inteiro. **Adicionar mesmo assim** autoriza apenas datas ausentes, mantendo as demais validações, como VOZES e processos ativos.

Verificação adicional: `node Testes/datas-processos.mjs`.

Verificação: `node Testes/importacao-cabecalhos.mjs`. Os testes usam dados fictícios e não acessam o banco de produção.
