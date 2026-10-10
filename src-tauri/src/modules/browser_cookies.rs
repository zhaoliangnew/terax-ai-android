//! 内置浏览器的「会话 cookie」落盘。
//!
//! 很多站点(阿里云/云效登录就是)把登录态放在不带过期时间的会话 cookie
//! 里。WebKit 只在内存里留着它们:App 一重启、或者用到这个数据仓库的网页
//! 全关了(比如云效浮层的预览一关),登录就没了,每次都得重新输密码。
//! 这里在每次页面加载完把会话 cookie 记到 App 数据目录,新开网页时先放回去。
//!
//! macOS 上不走 tauri/wry 的 cookies()/set_cookie():它们经过 cookie 库,
//! 域名开头的 "." 会被去掉。`.aliyun.com` 变成 `aliyun.com` 写回 WebKit 就成了
//! 只对 aliyun.com 这一个主机生效,devops.aliyun.com 收不到登录票据,等于没恢复。
//! 所以直接用 WKHTTPCookieStore,原样保留域名。

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, Webview};

const FILE: &str = "inapp-session-cookies.json";
/// 上限:页面多了会话 cookie 会越攒越多,只留这些
const MAX: usize = 400;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Saved {
    name: String,
    value: String,
    /// 原样的域名:带 "." 开头表示子域名也能用,不带表示只给这个主机
    domain: String,
    path: String,
    secure: bool,
    http_only: bool,
    same_site: Option<String>,
}

fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(FILE))
}

fn key(c: &Saved) -> String {
    format!("{}\u{1}{}\u{1}{}", c.domain, c.path, c.name)
}

fn load<R: Runtime>(app: &AppHandle<R>) -> BTreeMap<String, Saved> {
    let Some(p) = file(app) else {
        return BTreeMap::new();
    };
    let Ok(text) = std::fs::read_to_string(p) else {
        return BTreeMap::new();
    };
    let list: Vec<Saved> = serde_json::from_str(&text).unwrap_or_default();
    list.into_iter().map(|c| (key(&c), c)).collect()
}

fn store<R: Runtime>(app: &AppHandle<R>, map: &BTreeMap<String, Saved>) {
    let Some(p) = file(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let list: Vec<&Saved> = map.values().collect();
    let Ok(text) = serde_json::to_string(&list) else {
        return;
    };
    let tmp = p.with_extension("json.tmp");
    if std::fs::write(&tmp, text).is_err() {
        return;
    }
    // 里面是登录态,只给自己读写
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    let _ = std::fs::rename(&tmp, &p);
}

/// 把这次读到的会话 cookie 并进文件。同名(域名+路径+名字)的以新的为准。
fn merge(map: &mut BTreeMap<String, Saved>, fresh: Vec<Saved>) {
    for s in fresh {
        map.insert(key(&s), s);
    }
    while map.len() > MAX {
        let Some(k) = map.keys().next().cloned() else {
            break;
        };
        map.remove(&k);
    }
}

/// 页面加载完调:把当前所有会话 cookie 合并记下来。读 cookie 要回主线程
/// 拿结果,放到后台线程里等,不卡页面也不在 Windows 上死锁。
pub fn remember<R: Runtime>(app: &AppHandle<R>, wv: &Webview<R>) {
    let app = app.clone();
    let wv = wv.clone();
    std::thread::spawn(move || {
        let fresh = match native::session_cookies(&wv) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("inapp cookies: read failed: {e}");
                return;
            }
        };
        let mut map = load(&app);
        let before = map.clone();
        let n = fresh.len();
        merge(&mut map, fresh);
        if map != before {
            store(&app, &map);
            log::info!(
                "inapp cookies: saved {n} session cookies ({} kept)",
                map.len()
            );
        }
    });
}

/// 新开网页时调(导航到真正的页面之前):把记下的会话 cookie 放回去。
/// 过期了也没关系,站点会再要求登录,登录完又会被记下新的。
pub fn restore<R: Runtime>(app: &AppHandle<R>, wv: &Webview<R>) {
    let list: Vec<Saved> = load(app).into_values().collect();
    if list.is_empty() {
        return;
    }
    let n = list.len();
    match native::set_cookies(wv, list) {
        Ok(()) => log::info!("inapp cookies: restored {n}"),
        Err(e) => log::warn!("inapp cookies: restore failed: {e}"),
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::Saved;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{
        ns_string, NSArray, NSHTTPCookie, NSHTTPCookieDomain, NSHTTPCookieName, NSHTTPCookiePath,
        NSHTTPCookiePropertyKey, NSHTTPCookieSameSitePolicy, NSHTTPCookieSecure, NSHTTPCookieValue,
        NSMutableDictionary, NSString,
    };
    use objc2_web_kit::WKWebView;
    use std::ptr::NonNull;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::{Runtime, Webview};

    const TIMEOUT: Duration = Duration::from_secs(5);

    /// 数据仓库里所有没有过期时间的 cookie,域名原样。
    pub fn session_cookies<R: Runtime>(wv: &Webview<R>) -> Result<Vec<Saved>, String> {
        let (tx, rx) = mpsc::channel::<Vec<Saved>>();
        wv.with_webview(move |pw| {
            let tx = tx.clone();
            let handler = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
                // SAFETY: WebKit 回调期间数组有效
                let arr = unsafe { cookies.as_ref() };
                let mut out = Vec::new();
                for c in arr.iter() {
                    if c.expiresDate().is_some() {
                        continue;
                    }
                    out.push(Saved {
                        name: c.name().to_string(),
                        value: c.value().to_string(),
                        domain: c.domain().to_string(),
                        path: c.path().to_string(),
                        secure: c.isSecure(),
                        http_only: c.isHTTPOnly(),
                        same_site: c.sameSitePolicy().map(|p| p.to_string()),
                    });
                }
                let _ = tx.send(out);
            });
            // SAFETY: macOS 上 inner() 就是活着的 WKWebView,这个闭包在主线程跑
            unsafe {
                let webview = &*(pw.inner() as *mut WKWebView);
                let store = webview.configuration().websiteDataStore().httpCookieStore();
                store.getAllCookies(&handler);
            }
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(TIMEOUT)
            .map_err(|_| "读 cookie 超时".to_string())
    }

    fn to_ns(s: &Saved) -> Option<Retained<NSHTTPCookie>> {
        let name = NSString::from_str(&s.name);
        let value = NSString::from_str(&s.value);
        let domain = NSString::from_str(&s.domain);
        let path = NSString::from_str(&s.path);
        // SAFETY: NSHTTPCookie 的属性 key 是 Foundation 导出的常量
        unsafe {
            let props: Retained<NSMutableDictionary<NSHTTPCookiePropertyKey, AnyObject>> =
                NSMutableDictionary::from_slices(
                    &[
                        NSHTTPCookieName,
                        NSHTTPCookieValue,
                        NSHTTPCookieDomain,
                        NSHTTPCookiePath,
                    ],
                    &[&*name, &*value, &*domain, &*path],
                );
            if s.secure {
                props.insert(NSHTTPCookieSecure, ns_string!("TRUE"));
            }
            if s.http_only {
                props.insert(ns_string!("HttpOnly"), ns_string!("TRUE"));
            }
            // 只写 lax/strict:none 本来就是默认,显式写 none 又没带 Secure 时
            // WebKit 可能整条拒收
            if let Some(ss) = s.same_site.as_deref().map(str::to_ascii_lowercase) {
                if ss == "lax" || ss == "strict" {
                    let ss = NSString::from_str(&ss);
                    props.insert(NSHTTPCookieSameSitePolicy, &*ss);
                }
            }
            // 不给过期时间:放回去还是会话 cookie,和原来一样
            NSHTTPCookie::cookieWithProperties(&props)
        }
    }

    /// 一次放回一批,等全部写完再返回(之后才导航到真正的页面)。
    pub fn set_cookies<R: Runtime>(wv: &Webview<R>, list: Vec<Saved>) -> Result<(), String> {
        let (tx, rx) = mpsc::channel::<()>();
        let total = list.len();
        wv.with_webview(move |pw| {
            // SAFETY: 同 session_cookies
            unsafe {
                let webview = &*(pw.inner() as *mut WKWebView);
                let store = webview.configuration().websiteDataStore().httpCookieStore();
                for s in &list {
                    match to_ns(s) {
                        Some(c) => {
                            let tx = tx.clone();
                            let done = RcBlock::new(move || {
                                let _ = tx.send(());
                            });
                            store.setCookie_completionHandler(&c, Some(&done));
                        }
                        // 建不出来的(字段不合法)当作写完了,别让整批卡住
                        None => {
                            let _ = tx.send(());
                        }
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
        for _ in 0..total {
            rx.recv_timeout(TIMEOUT)
                .map_err(|_| "写 cookie 超时".to_string())?;
        }
        Ok(())
    }
    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn native_cookie_accepts_nonsecure_none_policy() {
            let saved = Saved {
                name: "test_ticket".into(),
                value: "test_value".into(),
                domain: ".aliyun.com".into(),
                path: "/".into(),
                secure: false,
                http_only: true,
                same_site: Some("none".into()),
            };
            let cookie = to_ns(&saved).expect("legacy login cookie");
            assert_eq!(cookie.domain().to_string(), saved.domain);
            assert!(!cookie.isSecure());
            assert!(cookie.isHTTPOnly());
        }

        #[test]
        fn native_cookie_preserves_auth_attributes() {
            for policy in [None, Some("none"), Some("lax"), Some("strict")] {
                let saved = Saved {
                    name: "test_ticket".into(),
                    value: "test_value".into(),
                    domain: ".aliyun.com".into(),
                    path: "/".into(),
                    secure: true,
                    http_only: true,
                    same_site: policy.map(str::to_owned),
                };
                let cookie = to_ns(&saved).expect("valid session cookie");
                assert_eq!(cookie.domain().to_string(), saved.domain);
                assert_eq!(cookie.name().to_string(), saved.name);
                assert_eq!(cookie.value().to_string(), saved.value);
                assert!(cookie.isSecure());
                assert!(cookie.isHTTPOnly());
                assert!(cookie.expiresDate().is_none());
                if matches!(policy, Some("lax" | "strict")) {
                    assert_eq!(
                        cookie.sameSitePolicy().map(|s| s.to_string()).as_deref(),
                        policy
                    );
                }
            }
        }
    }
}

/// 其他平台走 tauri 自己的接口(WebView2 的域名处理和 WebKit 不一样,没那个
/// 去掉 "." 的问题)。
#[cfg(not(target_os = "macos"))]
mod native {
    use super::Saved;
    use tauri::webview::cookie::{Cookie, SameSite};
    use tauri::{Runtime, Webview};

    fn is_session(c: &Cookie<'_>) -> bool {
        c.max_age().is_none() && c.expires().is_none_or(|e| e.is_session())
    }

    pub fn session_cookies<R: Runtime>(wv: &Webview<R>) -> Result<Vec<Saved>, String> {
        let cookies = wv.cookies().map_err(|e| e.to_string())?;
        Ok(cookies
            .into_iter()
            .filter(|c| is_session(c))
            .filter_map(|c| {
                Some(Saved {
                    name: c.name().to_string(),
                    value: c.value().to_string(),
                    domain: c.domain()?.to_string(),
                    path: c.path().unwrap_or("/").to_string(),
                    secure: c.secure().unwrap_or(false),
                    http_only: c.http_only().unwrap_or(false),
                    same_site: c.same_site().map(|s| s.to_string()),
                })
            })
            .collect())
    }

    pub fn set_cookies<R: Runtime>(wv: &Webview<R>, list: Vec<Saved>) -> Result<(), String> {
        for s in list {
            let mut c = Cookie::new(s.name, s.value);
            c.set_domain(s.domain);
            c.set_path(s.path);
            c.set_secure(s.secure);
            c.set_http_only(s.http_only);
            match s
                .same_site
                .as_deref()
                .map(str::to_ascii_lowercase)
                .as_deref()
            {
                Some("strict") => c.set_same_site(SameSite::Strict),
                Some("lax") => c.set_same_site(SameSite::Lax),
                Some("none") => c.set_same_site(SameSite::None),
                _ => {}
            }
            wv.set_cookie(c).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(domain: &str, name: &str, value: &str) -> Saved {
        Saved {
            name: name.into(),
            value: value.into(),
            domain: domain.into(),
            path: "/".into(),
            secure: true,
            http_only: true,
            same_site: None,
        }
    }

    #[test]
    fn key_keeps_leading_dot_distinct() {
        // .aliyun.com(子域名都能用)和 aliyun.com(只给这个主机)是两条
        assert_ne!(
            key(&saved(".aliyun.com", "t", "1")),
            key(&saved("aliyun.com", "t", "1"))
        );
    }

    #[test]
    fn merge_replaces_same_cookie_and_caps() {
        let mut map = BTreeMap::new();
        merge(&mut map, vec![saved(".aliyun.com", "t", "old")]);
        merge(&mut map, vec![saved(".aliyun.com", "t", "new")]);
        assert_eq!(map.len(), 1);
        assert_eq!(map.values().next().unwrap().value, "new");
        let many = (0..MAX + 10)
            .map(|i| saved(".x.com", &format!("c{i}"), "v"))
            .collect();
        merge(&mut map, many);
        assert_eq!(map.len(), MAX);
    }
}
