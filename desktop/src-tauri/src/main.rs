#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::HashSet,sync::{Mutex,Arc,atomic::{AtomicU16,Ordering}},time::Duration};
use tauri::{Manager,State,RunEvent};
use tauri_plugin_shell::{ShellExt,process::{CommandEvent,CommandChild}};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::watch;
struct Service { child:Mutex<Option<CommandChild>>, ready:watch::Receiver<Option<Result<String,String>>>, allowed:HashSet<String> }
#[tauri::command]
async fn service_url(state:State<'_,Service>)->Result<String,String>{
 let mut ready=state.ready.clone();
 let value=tokio::time::timeout(Duration::from_secs(30),ready.wait_for(|v|v.is_some())).await.map_err(|_|"本地服务启动超时".to_string())?.map_err(|_|"本地服务已退出".to_string())?;
 value.as_ref().unwrap().clone()
}
fn permitted(url:&str,allowed:&HashSet<String>)->bool{
 let Ok(u)=tauri::Url::parse(url) else{return false};
 if u.scheme()!="https"||!u.username().is_empty()||u.password().is_some(){return false}
 if allowed.contains(url){return true}
 matches!(u.host_str(),Some("bgm.tv")|Some("bangumi.tv")) && u.port().is_none() && u.query().is_none() && u.fragment().is_none() && u.path().strip_prefix("/subject/").is_some_and(|s|!s.is_empty()&&s.chars().all(|c|c.is_ascii_digit()))
}
#[tauri::command]
fn open_official(app:tauri::AppHandle,state:State<'_,Service>,url:String)->Result<(),String>{
 if !permitted(&url,&state.allowed){return Err("仅允许打开登记的官方平台与 Bangumi 资料页面".into())}
 app.opener().open_url(url,None::<&str>).map_err(|e|e.to_string())
}
fn stop(app:&tauri::AppHandle){if let Some(state)=app.try_state::<Service>(){if let Some(child)=state.child.lock().unwrap().take(){let _=child.kill();}}}
fn main(){
 let port=Arc::new(AtomicU16::new(0));let navigation_port=port.clone();
 let app=tauri::Builder::default()
 .plugin(tauri_plugin_shell::init()).plugin(tauri_plugin_opener::init())
 .plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(w)=app.get_webview_window("main"){let _=w.unminimize();let _=w.set_focus();}}))
 .setup(move |app|{
  let token=uuid::Uuid::new_v4().to_string();
  let beside=std::env::current_exe()?.parent().ok_or("Executable directory unavailable")?.join("desktop-ui");
  let ui=if beside.is_dir(){beside}else if cfg!(debug_assertions){std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")}else{app.path().resource_dir()?.join("desktop-ui")};
  let data=if cfg!(target_os="windows"){std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA unavailable")?).join("AnimeFlow")}else{app.path().app_local_data_dir()?};
  let command=app.shell().sidecar("animeflow-service")?.env("AF_PORT","0").env("AF_DESKTOP_TOKEN",&token).env("AF_DESKTOP_PARENT_PID",std::process::id().to_string()).env("AF_DESKTOP_UI_DIR",ui.to_string_lossy().to_string()).env("ANIMEFLOW_DATA_DIR",data.to_string_lossy().to_string());
  let (mut events,child)=command.spawn()?;let (tx,rx)=watch::channel(None);
  let dataset:serde_json::Value=serde_json::from_str(include_str!("../../../assets/platform-links.json"))?;
  let allowed=dataset["entries"].as_object().unwrap().values().flat_map(|v|v["links"].as_array().into_iter().flatten()).filter_map(|l|l["url"].as_str().map(str::to_owned)).collect();
  app.manage(Service{child:Mutex::new(Some(child)),ready:rx,allowed});
  tauri::WebviewWindowBuilder::from_config(app.handle(),&app.config().app.windows[0])?
   .on_navigation(move |u| {
    if u.scheme()=="tauri" && u.host_str()==Some("localhost"){return true}
    if matches!(u.host_str(),Some("tauri.localhost")) && matches!(u.scheme(),"http"|"https"){return true}
    u.scheme()=="http" && u.host_str()==Some("127.0.0.1") && u.port()==Some(navigation_port.load(Ordering::Relaxed))
   })
   .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
   .build()?;
  let handle=app.handle().clone();
  tauri::async_runtime::spawn(async move {
   let mut started=false;
   while let Some(event)=events.recv().await{
    match event{
     CommandEvent::Stdout(bytes)=>{if let Ok(value)=serde_json::from_slice::<serde_json::Value>(&bytes){if value["ready"]==true&&value["protocol"]==1 {if let Some(p)=value["port"].as_u64().filter(|p|*p>0&&*p<=65535){port.store(p as u16,Ordering::Relaxed);let _=tx.send(Some(Ok(format!("http://127.0.0.1:{p}/desktop/?session={token}"))));started=true;}}}},
     CommandEvent::Terminated(_)=>{let _=tx.send(Some(Err("本地服务已停止，请重新打开 AnimeFlow".into())));if started{handle.exit(1);}break},
     _=>{} // Consume stderr as well: logging pipes cannot stall the service.
    }
   }
  });
  Ok(())
 }).invoke_handler(tauri::generate_handler![service_url,open_official])
 .build(tauri::generate_context!()).expect("AnimeFlow desktop initialization failed");
 app.run(|handle,event|{if matches!(event,RunEvent::Exit|RunEvent::ExitRequested{..}){stop(handle)}});
}
#[cfg(test)] mod tests{
 use super::*;
 #[test]fn official_url_policy(){let allowed=HashSet::from(["https://www.bilibili.com/bangumi/media/md1".to_string()]);assert!(permitted("https://bgm.tv/subject/12",&allowed));assert!(permitted("https://www.bilibili.com/bangumi/media/md1",&allowed));for u in ["javascript:alert(1)","file:///etc/passwd","https://bgm.tv.evil/subject/12","https://bgm.tv/subject/12?redirect=x","https://user@bgm.tv/subject/12","http://127.0.0.1:5173"]{assert!(!permitted(u,&allowed));}}
}
