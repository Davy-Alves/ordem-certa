using System;
using System.IO;
using System.Diagnostics;
using System.ServiceProcess;
using System.Reflection;

class ServerHost : ServiceBase {
    Process child;
    StreamWriter log;
    readonly object gate = new object();
    readonly string root=AppDomain.CurrentDomain.BaseDirectory;
    readonly string name=Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location).ToUpperInvariant();
    bool stopping;
    ServerHost() { ServiceName="OrdemCerta"+name; CanStop=true; }
    static int Main(string[] args) {
        var host=new ServerHost();
        if(args.Length>0 && args[0]=="--service") { ServiceBase.Run(host); return 0; }
        try {
            host.StartChild(false);
            Console.CancelKeyPress+=(s,e)=>{e.Cancel=true;host.StopChild();};
            host.child.WaitForExit();
            return host.child.ExitCode;
        } catch(Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        finally {host.StopChild();}
    }
    protected override void OnStart(string[] args) {StartChild(true);}
    protected override void OnStop() {StopChild();}
    void StartChild(bool service) {
        Directory.CreateDirectory(Path.Combine(root,"logs"));
        log=new StreamWriter(Path.Combine(root,"logs",name+"-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".log"),true); log.AutoFlush=true;
        var info=new ProcessStartInfo(Path.Combine(root,"runtime","node.exe"),"\""+Path.Combine(root,"src",name.ToLowerInvariant()+".mjs")+"\"");
        info.WorkingDirectory=root;info.UseShellExecute=false;info.CreateNoWindow=true;
        info.RedirectStandardOutput=true;info.RedirectStandardError=true;
        child=new Process();child.StartInfo=info;child.EnableRaisingEvents=true;
        DataReceivedEventHandler output=(s,e)=>{if(e.Data!=null)lock(gate){if(log!=null)log.WriteLine(e.Data);if(!service)Console.WriteLine(e.Data);}};
        child.OutputDataReceived+=output;child.ErrorDataReceived+=output;
        if(service)child.Exited+=(s,e)=>{if(!stopping)Environment.Exit(1);};
        child.Start();child.BeginOutputReadLine();child.BeginErrorReadLine();
        if(!service)Console.WriteLine(name+" iniciado. Ctrl+C para encerrar. Logs em "+Path.Combine(root,"logs"));
    }
    void StopChild() {
        stopping=true;
        if(child!=null && !child.HasExited) {child.Kill();child.WaitForExit(10000);}
        lock(gate){if(log!=null){log.Dispose();log=null;}}
    }
}
