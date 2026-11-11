using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Windows.Forms;
class Installer {
    [STAThread] static void Main() {
        try {
            string dest=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Satel","OrdemCerta","Aplicativo");
            if(MessageBox.Show("Instalar o Ordem Certa neste computador?\n\nPasta: "+dest,"Ordem Certa",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
            Directory.CreateDirectory(dest);
            using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("cliente.zip"))
            using(var zip=new ZipArchive(stream,ZipArchiveMode.Read)) {
                foreach(var entry in zip.Entries) {
                    string file=Path.GetFullPath(Path.Combine(dest,entry.FullName));
                    if(!file.StartsWith(dest+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Pacote invalido.");
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    entry.ExtractToFile(file,true);
                }
            }
            dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            dynamic shortcut=shell.CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"Ordem Certa.lnk"));
            shortcut.TargetPath=Path.Combine(dest,"OrdemCerta.exe");shortcut.WorkingDirectory=dest;shortcut.Save();
            dynamic menu=shell.CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Ordem Certa.lnk"));
            menu.TargetPath=shortcut.TargetPath;menu.WorkingDirectory=dest;menu.Save();
            MessageBox.Show("Instalacao concluida. Abra o atalho Ordem Certa e informe o endereco HTTPS do TMSRV.","Ordem Certa");
        } catch(Exception e) {MessageBox.Show(e.Message,"Erro na instalacao",MessageBoxButtons.OK,MessageBoxIcon.Error);}
    }
}
