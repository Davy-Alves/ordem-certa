using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Windows.Forms;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class OrdemCerta : Form {
    readonly WebView2 view = new WebView2();
    readonly TextBox address = new TextBox();
    readonly Label status = new Label();
    readonly string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Satel", "OrdemCerta", "Perfil");
    readonly string configFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Satel", "OrdemCerta", "servidor.txt");
    Uri server;
    static bool smoke;
    [STAThread] static void Main(string[] args) {
        smoke=args.Length>0 && args[0]=="--smoke-test";
        if (args.Length > 0 && args[0] == "--check") {
            try { Console.WriteLine(CoreWebView2Environment.GetAvailableBrowserVersionString()); Environment.ExitCode=0; }
            catch { Environment.ExitCode=2; } return;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new OrdemCerta());
    }
    OrdemCerta() {
        Text="Ordem Certa | Satel"; Size=new Size(1400,900); MinimumSize=new Size(1000,650);
        StartPosition=FormStartPosition.CenterScreen; BackColor=Color.FromArgb(15,23,42);
        var top=new Panel { Dock=DockStyle.Top, Height=56, BackColor=Color.FromArgb(15,23,42), Padding=new Padding(12) };
        var label=new Label { Text="ORDEM CERTA", ForeColor=Color.White, Font=new Font("Segoe UI",11,FontStyle.Bold), AutoSize=true, Location=new Point(14,18) };
        address.SetBounds(170,14,410,27); address.Anchor=AnchorStyles.Left|AnchorStyles.Top;
        address.Text=smoke ? Environment.GetEnvironmentVariable("OC_SMOKE_URL") : File.Exists(configFile) ? File.ReadAllText(configFile).Trim() : "http://127.0.0.1:4173";
        var connect=new Button { Text="Conectar", Location=new Point(592,12), Size=new Size(95,30), BackColor=Color.White };
        var refresh=new Button { Text="Atualizar", Location=new Point(697,12), Size=new Size(95,30), BackColor=Color.White };
        connect.Click+=async(s,e)=>await Connect();
        refresh.Click+=(s,e)=>{if(view.CoreWebView2!=null)view.Reload();};
        status.Dock=DockStyle.Bottom;status.Height=26;status.ForeColor=Color.White;status.Padding=new Padding(12,4,0,0);
        status.Text="Informe o endereco do TMSRV.";
        top.Controls.AddRange(new Control[]{label,address,connect,refresh});
        view.Dock=DockStyle.Fill;
        Controls.Add(view);Controls.Add(top);Controls.Add(status);
        Shown+=async(s,e)=>await Connect();
    }
    async Task Connect() {
        try {
            Uri next;
            if(!Uri.TryCreate(address.Text.Trim(),UriKind.Absolute,out next) || !(next.Scheme=="https" || next.Scheme=="http") || !string.IsNullOrEmpty(next.UserInfo))
                throw new Exception("Informe uma URL HTTP/HTTPS valida do TMSRV.");
            if(next.Scheme=="http" && !next.IsLoopback)
                throw new Exception("Para conexoes remotas, configure HTTPS no TMSRV e informe https://seu-dominio.");
            server=new Uri(next.GetLeftPart(UriPartial.Authority));
            if(!smoke){Directory.CreateDirectory(Path.GetDirectoryName(configFile));File.WriteAllText(configFile,server.ToString());}
            if(view.CoreWebView2==null) {
                var env=await CoreWebView2Environment.CreateAsync(null,smoke ? Environment.GetEnvironmentVariable("OC_SMOKE_DIR") : profile);
                await view.EnsureCoreWebView2Async(env);
                view.CoreWebView2.Settings.AreDevToolsEnabled=false;
                view.CoreWebView2.Settings.IsStatusBarEnabled=false;
                view.CoreWebView2.NavigationStarting+=(s,e)=>{
                    Uri target;
                    if(Uri.TryCreate(e.Uri,UriKind.Absolute,out target) && target.GetLeftPart(UriPartial.Authority)!=server.GetLeftPart(UriPartial.Authority)) {
                        e.Cancel=true; OpenExternal(e.Uri);
                    }
                };
                view.CoreWebView2.NewWindowRequested+=async(s,e)=>{
                    e.Handled=true;
                    if(e.Uri=="about:blank") {
                        var deferral=e.GetDeferral();
                        try {
                            var popup=new Form{Text="Ordem Certa | Relatorio",Size=new Size(1100,800)};
                            var popupView=new WebView2{Dock=DockStyle.Fill};
                            popup.Controls.Add(popupView);popup.Show(this);
                            await popupView.EnsureCoreWebView2Async(env);
                            e.NewWindow=popupView.CoreWebView2;
                        } finally {deferral.Complete();}
                    } else OpenExternal(e.Uri);
                };
                view.CoreWebView2.NavigationCompleted+=(s,e)=>{status.Text=e.IsSuccess ? "Conectado a "+server.Host : "Nao foi possivel conectar. Verifique o endereco e os servidores. Erro: "+e.WebErrorStatus;};
                if(smoke)view.CoreWebView2.NavigationCompleted+=async(s,e)=>{
                    var result=await view.CoreWebView2.ExecuteScriptAsync("Boolean(document.querySelector('#loginForm'))");
                    File.WriteAllText(Path.Combine(Environment.GetEnvironmentVariable("OC_SMOKE_DIR"),"result.txt"),e.IsSuccess && result=="true" ? "PASS WebView2 native client login rendered" : "FAIL "+result);
                    Environment.ExitCode=e.IsSuccess && result=="true"?0:1;Close();
                };
                view.CoreWebView2.DownloadStarting+=(s,e)=>{e.Handled=false;};
            }
            status.Text="Conectando a "+server;
            view.CoreWebView2.Navigate(server.ToString());
        } catch(Exception e) {
            if(smoke){File.WriteAllText(Path.Combine(Environment.GetEnvironmentVariable("OC_SMOKE_DIR"),"result.txt"),"FAIL "+e.Message);Environment.ExitCode=1;Close();return;}
            status.Text="Falha de conexao";
            MessageBox.Show(e.Message+"\n\nO cliente precisa do Microsoft Edge WebView2 Runtime. Consulte o guia de instalacao.","Ordem Certa",MessageBoxButtons.OK,MessageBoxIcon.Warning);
        }
    }
    void OpenExternal(string url) {
        Uri uri;
        if(Uri.TryCreate(url,UriKind.Absolute,out uri) && (uri.Scheme=="https" || uri.Scheme=="http"))
            Process.Start(new ProcessStartInfo(url){UseShellExecute=true});
    }
}
