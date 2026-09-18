// ============================================================================
// 本地文件能力（Rooter 本地优先助手）
//   放置路径：src-tauri/src/app/fs.rs
//   命令：
//     pick_directory  — 弹原生系统选择器，让用户挑一个本机目录
//     fs_list         — 列出某目录下的直接子项（文件/文件夹）
//     fs_read         — 读取一个文本文件的内容（有大小上限）
//
//   安全红线（guard_path）：
//     - 只允许访问用户主目录（~）以内的路径
//     - 明确挡掉敏感目录/文件：.ssh / .aws / .gnupg / .config 下的凭据、
//       .env、私钥、keychain 等
//   这些命令返回 Result<_, String>，风格与本仓库既有命令一致。
// ============================================================================

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;
use tauri_plugin_dialog::DialogExt;

/// 读取文件的大小上限（2 MiB）。超过则拒绝，避免把大文件读进内存。
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct PickResult {
    /// 选中目录的绝对路径；用户取消时为 None
    pub path: Option<String>,
    /// 目录名（路径最后一段），方便前端显示
    pub name: Option<String>,
}

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// 文件大小（字节）；目录为 0
    pub size: u64,
}

/// 取用户主目录。拿不到就报错（几乎不会发生）。
fn home_dir() -> Result<PathBuf, String> {
    // std 没有稳定的 home_dir，用环境变量兜底（macOS/Linux 用 HOME，Windows 用 USERPROFILE）
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位用户主目录".to_string())
}

/// 敏感路径片段：命中任意一个即拒绝访问（大小写不敏感匹配路径中的组件）。
const BLOCKED_SEGMENTS: &[&str] = &[
    ".ssh", ".aws", ".gnupg", ".gpg", ".kube", ".docker",
    "keychains", ".password-store", ".config/gh", ".netrc",
];

/// 敏感文件名/后缀：命中即拒绝。
const BLOCKED_NAMES: &[&str] = &[
    ".env", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
    "credentials", ".pem", ".key", ".p12", ".keychain-db",
];

/// 把用户给的路径规整成绝对路径并做安全校验：
///   1) 必须能 canonicalize（存在且解析软链后仍在允许范围）
///   2) 必须落在用户主目录以内
///   3) 不得命中任何敏感片段/文件名
fn guard_path(input: &str) -> Result<PathBuf, String> {
    let home = home_dir()?;
    let raw = PathBuf::from(input);

    // 解析真实路径（消除 .. 和软链逃逸）；不存在直接报错
    let canonical = fs::canonicalize(&raw)
        .map_err(|e| format!("路径无法解析或不存在：{e}"))?;

    // 必须在主目录以内
    if !canonical.starts_with(&home) {
        return Err("越界：只允许访问用户主目录以内的路径".to_string());
    }

    // 敏感片段（逐段小写比对）
    let lower_components: Vec<String> = canonical
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .collect();
    for seg in BLOCKED_SEGMENTS {
        // 支持 "a/b" 这种多段片段
        let parts: Vec<&str> = seg.split('/').collect();
        if parts.len() == 1 {
            if lower_components.iter().any(|c| c == parts[0]) {
                return Err(format!("拒绝访问敏感目录：{seg}"));
            }
        } else {
            // 连续子序列匹配
            let window = parts.len();
            if lower_components
                .windows(window)
                .any(|w| w.iter().zip(parts.iter()).all(|(a, b)| a == b))
            {
                return Err(format!("拒绝访问敏感目录：{seg}"));
            }
        }
    }

    // 敏感文件名/后缀
    if let Some(fname) = canonical.file_name().map(|f| f.to_string_lossy().to_lowercase()) {
        for bad in BLOCKED_NAMES {
            if fname == *bad || fname.ends_with(bad) {
                return Err(format!("拒绝访问敏感文件：{fname}"));
            }
        }
    }

    Ok(canonical)
}

/// 弹出原生目录选择器。返回选中目录（用户取消时字段为 None）。
/// 选择结果同样经过 guard_path 校验：选了敏感/越界目录会被拒绝。
#[command]
pub async fn pick_directory(app: tauri::AppHandle) -> Result<PickResult, String> {
    // tauri-plugin-dialog 的 pick_folder 是回调式，这里用 channel 转成 async 等待
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |maybe| {
        let _ = tx.send(maybe);
    });
    let picked = rx
        .recv()
        .map_err(|e| format!("选择器通信失败：{e}"))?;

    let Some(folder) = picked else {
        // 用户取消
        return Ok(PickResult { path: None, name: None });
    };

    // FilePath -> 字符串路径
    let path_str = folder.to_string();
    let safe = guard_path(&path_str)?;
    let name = safe
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());

    Ok(PickResult {
        path: Some(safe.to_string_lossy().to_string()),
        name: Some(name),
    })
}

/// 列出目录直接子项。跳过无法读取 metadata 的项，不因单个坏项整体失败。
#[command]
pub fn fs_list(path: String) -> Result<Vec<FsEntry>, String> {
    let dir = guard_path(&path)?;
    if !dir.is_dir() {
        return Err("目标不是目录".to_string());
    }

    let mut out = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("无法读取目录：{e}"))?;
    for entry in read.flatten() {
        let p = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue, // 坏项跳过
        };
        let is_dir = meta.is_dir();
        let name = entry.file_name().to_string_lossy().to_string();
        out.push(FsEntry {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
        });
    }
    // 文件夹在前、再按名字排序，观感更像文件管理器
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(out)
}

/// 读取文本文件内容。超过大小上限或非 UTF-8 会报错。
#[command]
pub fn fs_read(path: String) -> Result<String, String> {
    let file = guard_path(&path)?;
    if !file.is_file() {
        return Err("目标不是文件".to_string());
    }
    let meta = fs::metadata(&file).map_err(|e| format!("无法读取文件信息：{e}"))?;
    if meta.len() > MAX_READ_BYTES {
        return Err(format!(
            "文件过大（{} 字节），超过上限 {} 字节",
            meta.len(),
            MAX_READ_BYTES
        ));
    }
    fs::read_to_string(&file).map_err(|e| format!("读取失败（可能不是文本文件）：{e}"))
}

// 供 lib.rs 之外的模块（如需要）复用路径校验。
#[allow(dead_code)]
pub fn is_path_allowed(p: &Path) -> bool {
    guard_path(&p.to_string_lossy()).is_ok()
}
