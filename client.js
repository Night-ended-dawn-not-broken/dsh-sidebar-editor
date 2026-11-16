/**
 * dsh-sidebar-editor - Client half.
 *
 * A right-Sidebar tab type (`file-editor`) plus an Edit action in the file
 * preview's header. The action opens the previewed file as its own tab; the
 * tab body loads it over `/api/sidebar-editor/read`, edits it in a plain
 * textarea, and saves over `/api/sidebar-editor/write` with the version it
 * loaded, so an external change surfaces as a conflict instead of being
 * overwritten.
 *
 * No Harness Client package is imported: controls, styles, and copy are local,
 * and only the documented slots and the `sidebarRight(Tabs)` services are used.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-editor',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const ID = 'dsh-sidebar-editor'
    const KIND = 'file-editor'
    const MANAGER_ID = `${ID}/manager`
    const MANAGER_KIND = 'file-manager'
    const GIT_ID = `${ID}/git`
    const GIT_KIND = 'git-repo'
    const NS = 'sidebarEditor'
    const PREFIX = '/api/sidebar-editor'
    const PLUGIN_HEADER = 'x-dsh-plugin'
    /** Must match the Host row's accepted guard token. */
    const PLUGIN_TOKEN = 'sidebar-editor'

    /** Extensions this editor refuses up front (the preview may still show them). */
    const BINARY_EXTENSIONS = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf',
      'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'zip', 'gz', 'tgz', '7z', 'rar',
      'mp3', 'wav', 'ogg', 'flac', 'mp4', 'mov', 'avi', 'mkv', 'webm',
      'woff', 'woff2', 'ttf', 'otf', 'eot', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm',
    ])

    const CSS = `
      .sbe-open {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 24px;
        padding: 0 7px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
        flex: none;
      }
      .sbe-open:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent);
      }
      .sbe-open:disabled { opacity: .5; cursor: default; }

      .sbe-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        min-width: 0;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 20px;
      }
      .sbe-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
        min-height: 34px;
        padding: 0 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .sbe-file {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        flex: 1;
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sbe-file svg { flex: none; color: var(--dsw-alias-label-secondary); }
      .sbe-spacer { flex: 1; }
      .sbe-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 24px;
        padding: 0 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
        flex: none;
      }
      .sbe-btn:hover:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent);
      }
      .sbe-btn:disabled { opacity: .5; cursor: default; }
      .sbe-btn.sbe-accent {
        color: var(--dsw-alias-brand-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1));
      }
      .sbe-btn.sbe-accent:hover:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
      }
      .sbe-btn.sbe-danger {
        color: var(--dsw-alias-state-error-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1));
      }
      .sbe-note {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        flex: none;
        margin: 8px 10px 0;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 18px;
        word-break: break-word;
      }
      .sbe-note.sbe-ok {
        color: var(--dsw-alias-label-secondary);
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, var(--dsw-alias-border-l1));
      }
      .sbe-note.sbe-warn {
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, var(--dsw-alias-border-l1));
      }
      .sbe-note.sbe-err {
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l1));
      }
      .sbe-note span { flex: 1; min-width: 0; }
      .sbe-note button {
        flex: none;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 5px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        height: 22px;
        padding: 0 7px;
        cursor: pointer;
      }
      .sbe-body {
        display: flex;
        flex: 1;
        min-height: 0;
        min-width: 0;
      }
      .sbe-editor {
        flex: 1;
        min-height: 0;
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        margin: 0;
        padding: 10px 12px 18px;
        border: none;
        outline: none;
        resize: none;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
        font-size: 12.5px;
        line-height: 20px;
        tab-size: 2;
        white-space: pre;
        overflow: auto;
        caret-color: var(--dsw-alias-brand-primary);
      }
      .sbe-editor::selection { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent); }
      .sbe-center {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 20px 18px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 20px;
      }
      .sbe-center .sbe-spinner {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 30%, transparent);
        border-top-color: var(--dsw-alias-label-secondary);
        animation: sbe-spin .8s linear infinite;
      }
      @keyframes sbe-spin { to { transform: rotate(360deg); } }
      .sbe-status {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        min-height: 24px;
        padding: 0 10px;
        border-top: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 16px;
        font-variant-numeric: tabular-nums;
      }
      .sbe-status .sbe-dirty {
        color: var(--dsw-alias-state-warn-primary);
      }
      .sbe-status .sbe-right { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sbe-title {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sbe-title svg { flex: none; color: var(--dsw-alias-label-secondary); }

      /* File manager */
      .sbm-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 20px;
      }
      .sbm-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: none;
        min-height: 34px;
        padding: 0 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .sbm-path {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .sbm-iconbtn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        flex: none;
      }
      .sbm-iconbtn:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent);
      }
      .sbm-iconbtn:disabled { opacity: .4; cursor: default; }
      .sbm-list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 4px 4px 8px;
      }
      .sbm-row {
        display: flex;
        align-items: center;
        gap: 4px;
        min-height: 30px;
        padding: 0 2px 0 4px;
        border-radius: 6px;
      }
      .sbm-row:hover {
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 8%, transparent);
      }
      .sbm-main {
        display: flex;
        align-items: center;
        gap: 7px;
        flex: 1;
        min-width: 0;
        height: 28px;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      .sbm-main svg { flex: none; color: var(--dsw-alias-label-secondary); }
      .sbm-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sbm-size {
        flex: none;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
      }
      .sbm-actions { display: flex; gap: 2px; flex: none; }
      .sbm-rowbtn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .sbm-rowbtn:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent);
      }
      .sbm-rowbtn.sbm-danger:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); }
      .sbm-rowbtn:disabled { opacity: .4; cursor: default; }
      .sbm-input {
        flex: 1;
        min-width: 0;
        height: 24px;
        padding: 0 6px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 5px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        outline: none;
      }
      .sbm-input:focus { border-color: var(--dsw-alias-brand-primary); }
      .sbm-create {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
        margin: 6px 8px 0;
        padding: 6px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
      }
      .sbm-create svg { flex: none; color: var(--dsw-alias-label-secondary); }
      .sbm-status {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        min-height: 24px;
        padding: 0 10px;
        border-top: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 16px;
      }
      .sbm-status .sbm-right {
        margin-left: auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sbm-empty {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
      }

      /* Git panel */
      .sbg-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 20px;
      }
      .sbg-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: none;
        min-height: 34px;
        padding: 0 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .sbg-branch {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .sbg-branch svg { flex: none; }
      .sbg-badge {
        display: inline-flex;
        align-items: center;
        height: 16px;
        padding: 0 6px;
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 10px;
        line-height: 14px;
        flex: none;
        white-space: nowrap;
      }
      .sbg-badge.ahead {
        color: var(--dsw-alias-brand-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, var(--dsw-alias-border-l1));
      }
      .sbg-badge.behind {
        color: var(--dsw-alias-state-warn-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l1));
      }
      .sbg-spacer { flex: 1; min-width: 0; }
      .sbg-list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 0 8px;
      }
      .sbg-repo-head {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        font-size: 11px;
        line-height: 16px;
        color: var(--dsw-alias-label-secondary);
      }
      .sbg-repo-head .sbg-repo-path,
      .sbg-repo-head .sbg-repo-commit {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sbg-section {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px 4px;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        font-weight: 600;
      }
      .sbg-change {
        display: flex;
        align-items: center;
        gap: 7px;
        min-height: 28px;
        padding: 0 10px;
        cursor: pointer;
      }
      .sbg-change:hover {
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 8%, transparent);
      }
      .sbg-pick {
        flex: none;
        width: 13px;
        height: 13px;
        margin: 0;
        accent-color: var(--dsw-alias-brand-primary);
        cursor: pointer;
      }
      .sbg-pick:disabled {
        cursor: default;
      }
      .sbg-selected {
        flex: none;
        font-weight: 400;
      }
      .sbg-link {
        flex: none;
        padding: 0;
        border: 0;
        background: none;
        color: var(--dsw-alias-brand-primary);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .sbg-link:hover:not(:disabled) {
        text-decoration: underline;
      }
      .sbg-link:disabled {
        color: var(--dsw-alias-label-secondary);
        cursor: default;
      }
      .sbg-code {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 16px;
        padding: 0 3px;
        border-radius: 3px;
        border: 1px solid var(--dsw-alias-border-l1);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 10px;
        line-height: 14px;
        flex: none;
      }
      .sbg-code.is-added,
      .sbg-code.is-untracked { color: var(--dsw-alias-state-success-primary); }
      .sbg-code.is-modified,
      .sbg-code.is-renamed,
      .sbg-code.is-copied,
      .sbg-code.is-typechange { color: var(--dsw-alias-state-warn-primary); }
      .sbg-code.is-deleted,
      .sbg-code.is-conflict { color: var(--dsw-alias-state-error-primary); }
      .sbg-change .sbg-change-path {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
      }
      .sbg-change .sbg-change-from {
        flex: none;
        max-width: 40%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
      }
      .sbg-clean {
        padding: 18px 10px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
      }
      .sbg-commit {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
        padding: 8px 10px;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .sbg-input {
        flex: 1;
        min-width: 0;
        height: 26px;
        padding: 0 7px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 5px;
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        outline: none;
      }
      .sbg-input:focus { border-color: var(--dsw-alias-brand-primary); }
      .sbg-center {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 20px 16px;
      }
      .sbg-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        width: 100%;
        max-width: 320px;
        text-align: center;
      }
      .sbg-card .sbg-card-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .sbg-card .sbg-card-path {
        width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
      }
      .sbg-card .sbg-card-hint {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
      }
      .sbg-clone-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
        margin-top: 4px;
        text-align: left;
      }
      .sbg-clone-form .sbg-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }
      .sbg-status {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        min-height: 24px;
        padding: 0 10px;
        border-top: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 16px;
      }
      .sbg-status .sbg-right {
        margin-left: auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: reduce) {
        .sbe-center .sbe-spinner { animation: none; }
      }
    `

    /** Simplified Chinese dictionary; the key set source of truth. */
    const zh = {
      'type.label': '文件编辑器',
      'action.open': '编辑',
      'action.openHint': '在右侧边栏中直接编辑这个文件',
      'editor.loading': '正在读取文件…',
      'editor.save': '保存',
      'editor.saving': '保存中…',
      'editor.saved': '已保存',
      'editor.savedAt': '已保存 · {time}',
      'editor.dirty': '未保存的修改',
      'editor.reload': '重新加载',
      'editor.reloadHint': '丢弃本地修改并从磁盘重新读取',
      'editor.reloadArmed': '再次点击丢弃修改',
      'editor.lines': '{count} 行',
      'editor.noFile': '这个标签没有可用的文件地址。',
      'editor.noFileHint': '请从右侧边栏的文件预览中点“编辑”重新打开。',
      'editor.openFailed': '读取失败：{message}',
      'editor.saveFailed': '保存失败：{message}',
      'editor.stale': '文件已在别处被修改，保存被拒绝。重新加载后可再保存。',
      'editor.sandboxDenied': '当前会话的沙箱策略不允许写入这个位置（工作区外只读）。',
      'editor.notText': '这不是文本文件（二进制或非 UTF-8），无法编辑。',
      'editor.tooLarge': '文件太大，超过侧栏编辑器上限，无法在这里打开。',
      'editor.retry': '重试',
      'editor.discard': '丢弃并重载',
      'editor.openInPreview': '重新打开',

      'manager.title': '文件管理',
      'manager.action': '管理',
      'manager.actionHint': '打开文件管理：新建、重命名、删除文件与文件夹',
      'manager.loading': '正在读取…',
      'manager.empty': '空文件夹',
      'manager.up': '返回上级',
      'manager.refresh': '刷新',
      'manager.newFile': '新建文件',
      'manager.newFolder': '新建文件夹',
      'manager.namePlaceholder': '输入名称，回车确认',
      'manager.create': '创建',
      'manager.confirmRename': '确定',
      'manager.cancel': '取消',
      'manager.rename': '重命名',
      'manager.delete': '删除',
      'manager.confirmDelete': '确认删除',
      'manager.deleteQuestion': '删除“{name}”？',
      'manager.deleteFolderQuestion': '删除文件夹“{name}”及其全部内容？',
      'manager.created': '已创建 {name}',
      'manager.renamed': '已重命名',
      'manager.deleted': '已删除 {name}',
      'manager.failed': '操作失败：{message}',
      'manager.items': '{count} 项',
      'manager.truncated': '条目过多，只显示了一部分。',
      'manager.invalidName': '名称不能为空，也不能包含 / 或 \\。',
      'manager.noSession': '请先选择会话。',

      'git.title': 'Git',
      'git.action': 'Git',
      'git.actionHint': '打开 Git 面板：状态、克隆、拉取、提交、推送',
      'git.loading': '正在读取 Git 状态…',
      'git.noRepo': '当前目录不是 Git 仓库',
      'git.noRepoHint': '可以在这里初始化一个新仓库，或把远端仓库克隆到工作区。',
      'git.init': '初始化仓库',
      'git.clone': '克隆仓库',
      'git.cloneUrl': '仓库地址（https / ssh / file）',
      'git.cloneDir': '目标文件夹名',
      'git.cloneDo': '克隆',
      'git.cancel': '取消',
      'git.workspace': '工作区',
      'git.refresh': '刷新状态',
      'git.fetch': '获取远端（fetch）',
      'git.pull': '拉取并快进（pull）',
      'git.push': '推送（push）',
      'git.branch': '分支',
      'git.detached': '分离头指针',
      'git.noUpstream': '无上游',
      'git.ahead': '领先 {n}',
      'git.behind': '落后 {n}',
      'git.changes': '变更 {n}',
      'git.clean': '工作区干净',
      'git.commit': '提交',
      'git.committing': '提交中…',
      'git.commitPlaceholder': '提交信息',
      'git.lastCommit': '最近提交',
      'git.noCommit': '还没有提交',
      'git.noSession': '请先选择会话。',
      'git.initDone': '已初始化仓库',
      'git.cloneDone': '已克隆到 {path}',
      'git.fetchDone': '已获取远端更新',
      'git.pullDone': '已拉取',
      'git.pushDone': '已推送',
      'git.commitDone': '已提交',
      'git.failed': '操作失败：{message}',
      'git.errNotFound': '没有找到 git 命令，请先安装 Git。',
      'git.errTimeout': 'Git 命令超时。',
      'git.errAuth': 'Git 认证失败：请先在终端配置凭据或 SSH key。',
      'git.errDiverged': '本地与远端已分叉，无法快进。请先在终端处理。',
      'git.errNotRepo': '这里不是 Git 仓库。',
      'git.errAlreadyRepo': '这里已经是 Git 仓库。',
      'git.errNoUpstream': '当前分支没有上游分支，无法拉取。',
      'git.errNoRemote': '没有配置远程仓库，无法推送。',
      'git.errNoChanges': '没有可提交的变更。',
      'git.errEmptyMessage': '请填写提交信息。',
      'git.errInvalidUrl': '仓库地址无效，只支持 http(s)、ssh、git、file。',
      'git.selectAll': '全选',
      'git.selectNone': '全不选',
      'git.selected': '已选 {n}/{total}',
      'git.commitSelected': '提交 {n} 项',
      'git.pick': '勾选要提交的文件',
      'git.errNoSelection': '请先选择要提交的文件。',
      'git.errNoStaged': '所选文件没有可提交的变更。',
      'git.errUnknownPath': '变更列表里没有这个文件，可能已刷新，请重试。',
      'git.errInvalidSelection': '提交列表不合法。',

      'error.exists': '同名文件或文件夹已存在。',
      'error.notFound': '目标不存在，可能已被移动或删除。',
      'error.notEmpty': '文件夹不是空的。',
      'error.permission': '系统拒绝了这次文件操作。',
      'error.busy': '文件正被其他程序占用。',
      'error.outsideWorkspace': '文件管理器只在会话工作区内操作。',
      'error.workspaceRoot': '不能对会话工作区根目录执行这个操作。',
      'error.invalidName': '名称在系统上不合法。',
      'error.symlink': '不通过符号链接执行这个操作。',
      'error.notDirectory': '目标不是文件夹。',
      'error.isDirectory': '目标是一个文件夹。',
      'error.crossDevice': '不能跨磁盘移动。',
    }

    /** English dictionary, checked against the Chinese key set. */
    const en = {
      'type.label': 'File editor',
      'action.open': 'Edit',
      'action.openHint': 'Edit this file directly in the right sidebar',
      'editor.loading': 'Reading file…',
      'editor.save': 'Save',
      'editor.saving': 'Saving…',
      'editor.saved': 'Saved',
      'editor.savedAt': 'Saved · {time}',
      'editor.dirty': 'Unsaved changes',
      'editor.reload': 'Reload',
      'editor.reloadHint': 'Discard local changes and read the file from disk',
      'editor.reloadArmed': 'Click again to discard',
      'editor.lines': '{count} lines',
      'editor.noFile': 'This tab has no usable file address.',
      'editor.noFileHint': 'Open it again from the file preview’s Edit button.',
      'editor.openFailed': 'Read failed: {message}',
      'editor.saveFailed': 'Save failed: {message}',
      'editor.stale': 'The file changed elsewhere, so the save was rejected. Reload, then save again.',
      'editor.sandboxDenied': 'The session sandbox does not allow writing here (outside the workspace).',
      'editor.notText': 'This is not a text file (binary or non-UTF-8), so it cannot be edited.',
      'editor.tooLarge': 'The file is too large for the sidebar editor.',
      'editor.retry': 'Retry',
      'editor.discard': 'Discard and reload',
      'editor.openInPreview': 'Reopen',

      'manager.title': 'File manager',
      'manager.action': 'Manage',
      'manager.actionHint': 'Open the file manager: create, rename, and delete files and folders',
      'manager.loading': 'Reading…',
      'manager.empty': 'Empty folder',
      'manager.up': 'Up one level',
      'manager.refresh': 'Refresh',
      'manager.newFile': 'New file',
      'manager.newFolder': 'New folder',
      'manager.namePlaceholder': 'Name, then Enter',
      'manager.create': 'Create',
      'manager.confirmRename': 'Rename',
      'manager.cancel': 'Cancel',
      'manager.rename': 'Rename',
      'manager.delete': 'Delete',
      'manager.confirmDelete': 'Delete',
      'manager.deleteQuestion': 'Delete “{name}”?',
      'manager.deleteFolderQuestion': 'Delete folder “{name}” and everything in it?',
      'manager.created': 'Created {name}',
      'manager.renamed': 'Renamed',
      'manager.deleted': 'Deleted {name}',
      'manager.failed': 'Operation failed: {message}',
      'manager.items': '{count} items',
      'manager.truncated': 'Too many entries; only some are shown.',
      'manager.invalidName': 'A name is required and cannot contain / or \\.',
      'manager.noSession': 'Select a session first.',

      'git.title': 'Git',
      'git.action': 'Git',
      'git.actionHint': 'Open the Git panel: status, clone, pull, commit, push',
      'git.loading': 'Reading Git status…',
      'git.noRepo': 'This directory is not a Git repository',
      'git.noRepoHint': 'Initialize a new repository here, or clone a remote into the workspace.',
      'git.init': 'Initialize repository',
      'git.clone': 'Clone repository',
      'git.cloneUrl': 'Repository URL (https / ssh / file)',
      'git.cloneDir': 'Target folder name',
      'git.cloneDo': 'Clone',
      'git.cancel': 'Cancel',
      'git.workspace': 'Workspace',
      'git.refresh': 'Refresh status',
      'git.fetch': 'Fetch from remote',
      'git.pull': 'Pull (fast-forward only)',
      'git.push': 'Push',
      'git.branch': 'Branch',
      'git.detached': 'Detached HEAD',
      'git.noUpstream': 'No upstream',
      'git.ahead': '{n} ahead',
      'git.behind': '{n} behind',
      'git.changes': 'Changes {n}',
      'git.clean': 'Working tree clean',
      'git.commit': 'Commit',
      'git.committing': 'Committing…',
      'git.commitPlaceholder': 'Commit message',
      'git.lastCommit': 'Last commit',
      'git.noCommit': 'No commits yet',
      'git.noSession': 'Select a session first.',
      'git.initDone': 'Repository initialized',
      'git.cloneDone': 'Cloned to {path}',
      'git.fetchDone': 'Fetched from remote',
      'git.pullDone': 'Pulled',
      'git.pushDone': 'Pushed',
      'git.commitDone': 'Committed',
      'git.failed': 'Operation failed: {message}',
      'git.errNotFound': 'The git command was not found. Install Git first.',
      'git.errTimeout': 'The Git command timed out.',
      'git.errAuth': 'Git authentication failed. Configure a credential helper or SSH key in a terminal first.',
      'git.errDiverged': 'Local and remote diverged; a fast-forward is impossible. Resolve it in a terminal first.',
      'git.errNotRepo': 'This directory is not a Git repository.',
      'git.errAlreadyRepo': 'This directory already is a Git repository.',
      'git.errNoUpstream': 'The current branch has no upstream, so it cannot be pulled.',
      'git.errNoRemote': 'No remote is configured, so nothing can be pushed.',
      'git.errNoChanges': 'There is nothing to commit.',
      'git.errEmptyMessage': 'Enter a commit message.',
      'git.errInvalidUrl': 'Invalid repository URL. Use http(s), ssh, git, or file.',
      'git.selectAll': 'Select all',
      'git.selectNone': 'Select none',
      'git.selected': '{n}/{total} selected',
      'git.commitSelected': 'Commit {n}',
      'git.pick': 'Choose the files to commit',
      'git.errNoSelection': 'Choose at least one file to commit.',
      'git.errNoStaged': 'The selected files have no changes to commit.',
      'git.errUnknownPath': 'That file is no longer in the change list; refresh and retry.',
      'git.errInvalidSelection': 'The submitted file list was not valid.',

      'error.exists': 'A file or folder with that name already exists.',
      'error.notFound': 'The target no longer exists.',
      'error.notEmpty': 'The folder is not empty.',
      'error.permission': 'The operating system refused the operation.',
      'error.busy': 'The file is in use by another program.',
      'error.outsideWorkspace': 'The file manager only works inside the session workspace.',
      'error.workspaceRoot': 'That operation cannot target the workspace root.',
      'error.invalidName': 'The name is not valid on this system.',
      'error.symlink': 'That operation is not allowed through a symbolic link.',
      'error.notDirectory': 'The target is not a folder.',
      'error.isDirectory': 'The target is a folder.',
      'error.crossDevice': 'Moving across disks is not supported.',
    }

    // ---------------------------------------------------------------------
    // Resource addresses (mirror dsh-util-workspace-path's file grammar)
    // ---------------------------------------------------------------------

    /** Component-encode one address segment, keeping `:` literal as the grammar does. */
    function encodeSegment(value) {
      return encodeURIComponent(value).replace(/%3A/gi, ':')
    }

    /**
     * Build the Session file address for an absolute path. Paths inside the
     * workspace may be relative, but the preview hands us an absolute path;
     * `sessionFileAddress` accepts that form too.
     */
    function sessionFileAddress(sessionId, absolutePath) {
      const normalized = String(absolutePath).replace(/\\/g, '/').replace(/^\.\//, '')
      const segments = normalized.split('/').map(encodeSegment)
      return `dsh-resource://file/session/${encodeSegment(String(sessionId))}/${segments.join('/')}`
    }

    /** Decode a Session file address back into `{ sessionId, path }`. */
    function parseFileAddress(address) {
      if (typeof address !== 'string') return undefined
      const match = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.*)$/.exec(address)
      if (match === null) return undefined
      try {
        const path = match[2]
          .split('/')
          .map((segment) => decodeURIComponent(segment))
          .join('/')
        return { sessionId: decodeURIComponent(match[1]), path }
      } catch {
        return undefined
      }
    }

    function basenameOf(path) {
      if (typeof path !== 'string' || path === '') return ''
      const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
      const at = normalized.lastIndexOf('/')
      return at === -1 ? normalized : normalized.slice(at + 1)
    }

    function extensionOf(path) {
      const name = basenameOf(path)
      const at = name.lastIndexOf('.')
      return at <= 0 ? '' : name.slice(at + 1).toLowerCase()
    }

    function isBinaryPath(path) {
      return BINARY_EXTENSIONS.has(extensionOf(path))
    }

    /** Join one name onto an absolute directory. */
    function joinName(directory, name) {
      const trimmed = String(directory).replace(/[\\/]+$/, '')
      return trimmed === '' ? name : `${trimmed}/${name}`
    }

    function dirnameOf(path) {
      const normalized = String(path)
      const at = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
      if (at < 0) return ''
      const head = normalized.slice(0, at)
      if (/^[A-Za-z]:$/.test(head)) return `${head}\\`
      return head === '' ? '/' : head
    }

    function validName(name) {
      return name !== '' && name !== '.' && name !== '..' && !/[\\/]/.test(name)
    }

    function formatBytes(size) {
      if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return ''
      if (size < 1024) return `${size} B`
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
      return `${(size / 1024 / 1024).toFixed(1)} MB`
    }

    function displayPathOf(path, root) {
      if (typeof path !== 'string') return ''
      if (typeof root === 'string' && root !== '' && path.toLowerCase().startsWith(root.toLowerCase())) {
        const rest = path.slice(root.length).replace(/^[\\/]+/, '')
        return rest === '' ? '/' : `/${rest.replace(/\\/g, '/')}`
      }
      return path
    }

    function samePathValue(left, right) {
      return (
        typeof left === 'string' &&
        typeof right === 'string' &&
        left.toLowerCase() === right.toLowerCase()
      )
    }

    function isInsidePath(root, child) {
      if (typeof root !== 'string' || typeof child !== 'string') return false
      const normalizedRoot = root.replace(/[\\/]+$/, '').toLowerCase()
      const normalizedChild = child.replace(/[\\/]+$/, '').toLowerCase()
      if (normalizedRoot === '' || normalizedChild === '') return false
      return (
        normalizedChild === normalizedRoot ||
        normalizedChild.startsWith(`${normalizedRoot}\\`) ||
        normalizedChild.startsWith(`${normalizedRoot}/`)
      )
    }

    /** Resolve the file this tab edits, from its params or its resource address. */
    function fileOf(tab) {
      const navigation = tab && tab.navigation
      const params = (navigation && navigation.params) || {}
      let address
      if (typeof tab?.address === 'string') address = tab.address
      else if (typeof tab?.contentId === 'string') address = tab.contentId
      else if (typeof tab?.resourceAddress === 'string') address = tab.resourceAddress
      else if (typeof tab?.resource === 'string') address = tab.resource
      else if (typeof params.address === 'string') address = params.address
      const parsed = parseFileAddress(address)
      return {
        sessionId: params.sessionId ?? parsed?.sessionId,
        path: params.absolutePath ?? parsed?.path,
      }
    }

    // ---------------------------------------------------------------------
    // Local HTTP
    // ---------------------------------------------------------------------

    async function postJson(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', [PLUGIN_HEADER]: PLUGIN_TOKEN },
        body: JSON.stringify(body),
      })
      let data = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }
      if (!response.ok) {
        const error = new Error(data?.error?.message ?? `HTTP ${response.status}`)
        error.code = data?.error?.code ?? 'HTTP_ERROR'
        error.status = response.status
        throw error
      }
      return data
    }

    function messageOf(error, tr) {
      switch (error?.code) {
        case 'TOO_LARGE':
          return tr('editor.tooLarge')
        case 'NOT_TEXT':
          return tr('editor.notText')
        case 'SANDBOX_DENIED':
          return tr('editor.sandboxDenied')
        case 'EXISTS':
          return tr('error.exists')
        case 'NOT_FOUND':
          return tr('error.notFound')
        case 'NOT_EMPTY':
          return tr('error.notEmpty')
        case 'PERMISSION':
          return tr('error.permission')
        case 'BUSY':
          return tr('error.busy')
        case 'OUTSIDE_WORKSPACE':
          return tr('error.outsideWorkspace')
        case 'WORKSPACE_ROOT':
          return tr('error.workspaceRoot')
        case 'INVALID_NAME':
          return tr('error.invalidName')
        case 'SYMLINK':
          return tr('error.symlink')
        case 'NOT_DIRECTORY':
          return tr('error.notDirectory')
        case 'IS_DIRECTORY':
          return tr('error.isDirectory')
        case 'CROSS_DEVICE':
          return tr('error.crossDevice')
        case 'GIT_NOT_FOUND':
          return tr('git.errNotFound')
        case 'GIT_TIMEOUT':
          return tr('git.errTimeout')
        case 'GIT_AUTH':
          return tr('git.errAuth')
        case 'GIT_DIVERGED':
          return tr('git.errDiverged')
        case 'NOT_A_REPO':
          return tr('git.errNotRepo')
        case 'ALREADY_REPO':
          return tr('git.errAlreadyRepo')
        case 'NO_UPSTREAM':
          return tr('git.errNoUpstream')
        case 'NO_REMOTE':
          return tr('git.errNoRemote')
        case 'NO_CHANGES':
          return tr('git.errNoChanges')
        case 'NO_STAGED':
          return tr('git.errNoStaged')
        case 'NO_SELECTION':
          return tr('git.errNoSelection')
        case 'UNKNOWN_PATH':
          return tr('git.errUnknownPath')
        case 'INVALID_SELECTION':
          return tr('git.errInvalidSelection')
        case 'EMPTY_MESSAGE':
          return tr('git.errEmptyMessage')
        case 'INVALID_GIT_URL':
          return tr('git.errInvalidUrl')
        default:
          return String(error?.message ?? error)
      }
    }

    function PencilIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('path', { key: 'a', d: 'M3.2 12.8l.5-2.6 6.9-6.9 2.1 2.1-6.9 6.9z' }),
          h('path', { key: 'b', d: 'M9.4 4.5l2.1 2.1' }),
        ],
      )
    }

    function FolderIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M1.9 4.3c0-.6.5-1.1 1.1-1.1h2.9l1.2 1.4h5.9c.6 0 1.1.5 1.1 1.1v5.9c0 .6-.5 1.1-1.1 1.1H3c-.6 0-1.1-.5-1.1-1.1z',
        }),
      )
    }

    function FileIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('path', { key: 'a', d: 'M4.1 1.9h4.9l3 3v8.2c0 .5-.4.9-.9.9H4.1c-.5 0-.9-.4-.9-.9V2.8c0-.5.4-.9.9-.9z' }),
          h('path', { key: 'b', d: 'M9 1.9v3.2h3' }),
        ],
      )
    }

    function ChevronUpIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M3.6 9.7L8 5.3l4.4 4.4' }),
      )
    }

    function PlusIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        [h('path', { key: 'a', d: 'M8 3.4v9.2' }), h('path', { key: 'b', d: 'M3.4 8h9.2' })],
      )
    }

    function FolderPlusIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('path', {
            key: 'a',
            d: 'M1.9 4.3c0-.6.5-1.1 1.1-1.1h2.9l1.2 1.4h5.9c.6 0 1.1.5 1.1 1.1v5.9c0 .6-.5 1.1-1.1 1.1H3c-.6 0-1.1-.5-1.1-1.1z',
          }),
          h('path', { key: 'b', d: 'M8 7.2v3.4' }),
          h('path', { key: 'c', d: 'M6.3 8.9h3.4' }),
        ],
      )
    }

    function RefreshIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('path', { key: 'a', d: 'M13.1 6.3A5.3 5.3 0 1 0 13 10' }),
          h('path', { key: 'b', d: 'M13.3 2.9v3.5h-3.5' }),
        ],
      )
    }

    function TrashIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('path', { key: 'a', d: 'M2.8 4.4h10.4' }),
          h('path', { key: 'b', d: 'M6.2 2.5h3.6' }),
          h('path', { key: 'c', d: 'M4.2 4.4l.5 8.3c0 .5.4.8.9.8h4.8c.5 0 .9-.3.9-.8l.5-8.3' }),
          h('path', { key: 'd', d: 'M6.6 6.9v4.2' }),
          h('path', { key: 'e', d: 'M9.4 6.9v4.2' }),
        ],
      )
    }

    function BranchIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('circle', { key: 'a', cx: 4, cy: 3.5, r: 1.5 }),
          h('circle', { key: 'b', cx: 4, cy: 12.5, r: 1.5 }),
          h('circle', { key: 'c', cx: 12, cy: 5, r: 1.5 }),
          h('path', { key: 'd', d: 'M4 5v6' }),
          h('path', { key: 'e', d: 'M12 6.5c0 2-1.6 3-3.6 3.3-2 .3-3.4.7-4.4 1.7' }),
        ],
      )
    }

    function ArrowDownIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [h('path', { key: 'a', d: 'M8 2.6v9.2' }), h('path', { key: 'b', d: 'M4.3 8.1L8 11.8l3.7-3.7' })],
      )
    }

    function PullIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('path', { key: 'a', d: 'M8 2.4v7.2' }),
          h('path', { key: 'b', d: 'M4.8 6.4L8 9.6l3.2-3.2' }),
          h('path', { key: 'c', d: 'M3 13h10' }),
        ],
      )
    }

    function PushIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('path', { key: 'a', d: 'M8 13.2V5.8' }),
          h('path', { key: 'b', d: 'M4.8 9L8 5.8 11.2 9' }),
          h('path', { key: 'c', d: 'M3 3h10' }),
        ],
      )
    }

    function CheckIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M3.2 8.4l3 3 6.6-7' }),
      )
    }

    /** Local translate bound at apply; slot props still supply `t` on re-render. */
    let translate = (key) => key

    // ---------------------------------------------------------------------
    // Edit action (preview header and unsupported-preview empty state)
    // ---------------------------------------------------------------------

    function EditAction(props) {
      const tr = props.t ?? translate
      const standard = props
      const sessionId = standard.sessionId
      const absolutePath = standard.absolutePath
      const disabled = typeof sessionId !== 'string' || typeof absolutePath !== 'string'
      if (disabled) return null
      if (isBinaryPath(absolutePath)) return null

      const onClick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const address = sessionFileAddress(sessionId, absolutePath)
        const params = { sessionId, absolutePath, address }
        try {
          ctx.sidebarRight.openResource(address, { kind: KIND, params })
        } catch (error) {
          console.warn('[dsh-sidebar-editor] openResource failed, falling back to a page tab', error)
          try {
            ctx.sidebarRight.openTab(KIND, { params })
          } catch (fallbackError) {
            console.error('[dsh-sidebar-editor] could not open the editor tab', fallbackError)
          }
        }
      }

      return h(
        'button',
        {
          type: 'button',
          className: 'sbe-open',
          title: tr('action.openHint'),
          'aria-label': tr('action.openHint'),
          onClick,
        },
        [h(PencilIcon, { key: 'i', size: 13 }), h('span', { key: 'l' }, tr('action.open'))],
      )
    }

    // ---------------------------------------------------------------------
    // Editor body
    // ---------------------------------------------------------------------

    function EditorBody(props) {
      const tr = props.t ?? translate
      const tabInfo = props.useTabInfo ? props.useTabInfo() : undefined
      const tab = tabInfo ? tabInfo.tab : undefined
      const info = fileOf(tab)
      const sessionId = info.sessionId ?? props.sessionId
      const path = info.path

      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState(null)
      const [draft, setDraft] = useState('')
      const [savedText, setSavedText] = useState('')
      const [version, setVersion] = useState(undefined)
      const [absolutePath, setAbsolutePath] = useState(path)
      const [saving, setSaving] = useState(false)
      const [note, setNote] = useState(null)
      const [reloadArmed, setReloadArmed] = useState(false)
      const textareaRef = useRef(null)
      const noteTimer = useRef(undefined)

      const clearNoteTimer = () => {
        if (noteTimer.current !== undefined) {
          clearTimeout(noteTimer.current)
          noteTimer.current = undefined
        }
      }

      const showNote = useCallback((kind, text, extra) => {
        clearNoteTimer()
        setNote({ kind, text, ...(extra || {}) })
        if (kind === 'ok') {
          noteTimer.current = setTimeout(() => setNote(null), 4000)
        }
      }, [])

      useEffect(() => clearNoteTimer, [])

      const load = useCallback(async () => {
        setReloadArmed(false)
        clearNoteTimer()
        setNote(null)
        setLoadError(null)
        if (typeof sessionId !== 'string' || typeof path !== 'string' || path === '') {
          setLoading(false)
          setLoadError({ code: 'NO_FILE', message: '' })
          return
        }
        setLoading(true)
        try {
          const data = await postJson(`${PREFIX}/read`, { sessionId, path })
          setDraft(data.content)
          setSavedText(data.content)
          setVersion(data.version)
          setAbsolutePath(data.absolutePath ?? path)
        } catch (error) {
          setLoadError(error)
        } finally {
          setLoading(false)
        }
      }, [sessionId, path])

      useEffect(() => {
        load()
      }, [load])

      const dirty = draft !== savedText
      const lineCount = draft === '' ? 0 : draft.split('\n').length
      const fileName = basenameOf(absolutePath ?? path) || tr('type.label')

      const save = useCallback(async () => {
        if (saving || loading) return
        if (typeof sessionId !== 'string' || typeof (absolutePath ?? path) !== 'string') return
        setSaving(true)
        clearNoteTimer()
        setNote(null)
        try {
          const data = await postJson(`${PREFIX}/write`, {
            sessionId,
            path: absolutePath ?? path,
            content: draft,
            version,
          })
          setVersion(data.version)
          setSavedText(draft)
          showNote('ok', tr('editor.savedAt', { time: new Date().toLocaleTimeString() }))
        } catch (error) {
          if (error?.code === 'STALE_VERSION') {
            showNote('warn', tr('editor.stale'), { reload: true })
          } else {
            showNote('err', tr('editor.saveFailed', { message: messageOf(error, tr) }))
          }
        } finally {
          setSaving(false)
        }
      }, [saving, loading, sessionId, absolutePath, path, draft, version, showNote, tr])

      const onReloadClick = () => {
        if (dirty && !reloadArmed) {
          setReloadArmed(true)
          showNote('warn', tr('editor.reloadHint'), { discard: true })
          return
        }
        load()
      }

      const onKeyDown = (event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
          event.preventDefault()
          save()
          return
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          const el = event.currentTarget
          const start = el.selectionStart
          const end = el.selectionEnd
          const next = `${draft.slice(0, start)}  ${draft.slice(end)}`
          setDraft(next)
          requestAnimationFrame(() => {
            if (textareaRef.current !== null) {
              textareaRef.current.selectionStart = start + 2
              textareaRef.current.selectionEnd = start + 2
            }
          })
        }
      }

      const header = h('div', { className: 'sbe-bar', key: 'bar' }, [
        h('span', { key: 'f', className: 'sbe-file', title: absolutePath ?? path ?? '' }, [
          h(PencilIcon, { key: 'i', size: 13 }),
          h('span', { key: 'n' }, fileName),
        ]),
        h('span', { key: 's', className: 'sbe-spacer' }),
        h(
          'button',
          {
            key: 'r',
            type: 'button',
            className: reloadArmed ? 'sbe-btn sbe-danger' : 'sbe-btn',
            disabled: loading || saving,
            title: reloadArmed ? tr('editor.reloadArmed') : tr('editor.reloadHint'),
            onClick: onReloadClick,
          },
          [
            h('span', { key: 'i', 'aria-hidden': true }, '↻'),
            h('span', { key: 'l' }, reloadArmed ? tr('editor.reloadArmed') : tr('editor.reload')),
          ],
        ),
        h(
          'button',
          {
            key: 'w',
            type: 'button',
            className: 'sbe-btn sbe-accent',
            disabled: saving || loading || !dirty,
            title: tr('editor.save'),
            onClick: save,
          },
          h('span', null, saving ? tr('editor.saving') : tr('editor.save')),
        ),
      ])

      if (loading) {
        return h('div', { className: 'sbe-root' }, [
          header,
          h('div', { key: 'c', className: 'sbe-center' }, [
            h('span', { key: 'i', className: 'sbe-spinner' }),
            h('span', { key: 'l' }, tr('editor.loading')),
          ]),
        ])
      }

      if (loadError !== null) {
        const noFile = loadError.code === 'NO_FILE'
        return h('div', { className: 'sbe-root' }, [
          header,
          h('div', { key: 'c', className: 'sbe-center' }, [
            h('span', { key: 't' }, noFile ? tr('editor.noFile') : messageOf(loadError, tr)),
            h('span', { key: 'h', style: { fontSize: 12 } }, noFile ? tr('editor.noFileHint') : ''),
            h(
              'button',
              { key: 'r', type: 'button', className: 'sbe-btn', onClick: load, disabled: noFile },
              tr('editor.retry'),
            ),
          ]),
        ])
      }

      const noteView = note === null
        ? null
        : h('div', { className: `sbe-note sbe-${note.kind}`, key: 'note' }, [
            h('span', { key: 't' }, note.text),
            note.reload === true
              ? h('button', { key: 'r', type: 'button', onClick: load }, tr('editor.discard'))
              : null,
            note.discard === true
              ? h('button', { key: 'd', type: 'button', onClick: load }, tr('editor.discard'))
              : null,
          ])

      return h('div', { className: 'sbe-root' }, [
        header,
        noteView,
        h('div', { className: 'sbe-body', key: 'body' }, [
          h('textarea', {
            key: 'editor',
            ref: textareaRef,
            className: 'sbe-editor',
            value: draft,
            spellCheck: false,
            autoCorrect: 'off',
            autoCapitalize: 'off',
            wrap: 'off',
            'aria-label': fileName,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown,
          }),
        ]),
        h('div', { className: 'sbe-status', key: 'status' }, [
          h('span', { key: 'd', className: dirty ? 'sbe-dirty' : undefined }, dirty ? tr('editor.dirty') : tr('editor.saved')),
          h('span', { key: 'l' }, tr('editor.lines', { count: lineCount })),
          h('span', { key: 'p', className: 'sbe-right', title: absolutePath ?? path ?? '' }, absolutePath ?? path ?? ''),
        ]),
      ])
    }

    // ---------------------------------------------------------------------
    // Chip title
    // ---------------------------------------------------------------------

    function EditorTitle(props) {
      const tr = props.t ?? translate
      const info = props.useTabInfo ? fileOf(props.useTabInfo().tab) : { path: undefined }
      const name = basenameOf(info.path) || tr('type.label')
      return h('span', { className: 'sbe-title', title: info.path ?? name }, [
        h(PencilIcon, { key: 'i', size: 12 }),
        h('span', { key: 'n' }, name),
      ])
    }

    // ---------------------------------------------------------------------
    // File manager (create / rename / delete, open in the editor)
    // ---------------------------------------------------------------------

    /** Open the manager page for one Session directory. */
    function openManager(sessionId, absolutePath) {
      try {
        ctx.sidebarRight.openTab(MANAGER_KIND, { params: { sessionId, absolutePath } })
      } catch (error) {
        console.error('[dsh-sidebar-editor] could not open the file manager', error)
      }
    }

    /** Header action on the Files tab: open the manager at the displayed directory. */
    function ManageAction(props) {
      const tr = props.t ?? translate
      if (typeof props.sessionId !== 'string' || typeof props.absolutePath !== 'string') return null
      const onClick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        openManager(props.sessionId, props.absolutePath)
      }
      return h(
        'button',
        {
          type: 'button',
          className: 'sbe-open',
          title: tr('manager.actionHint'),
          'aria-label': tr('manager.actionHint'),
          onClick,
        },
        [h(FolderIcon, { key: 'i', size: 13 }), h('span', { key: 'l' }, tr('manager.action'))],
      )
    }

    function ManagerBody(props) {
      const tr = props.t ?? translate
      const tabInfo = props.useTabInfo ? props.useTabInfo() : undefined
      const tab = tabInfo ? tabInfo.tab : undefined
      const params = (tab && tab.navigation && tab.navigation.params) || {}
      const paramPath = typeof params.absolutePath === 'string' ? params.absolutePath : undefined
      const paramSession = typeof params.sessionId === 'string' ? params.sessionId : undefined
      const sessionId = paramSession ?? props.sessionId
      const cwd = props.useSessions
        ? props.useSessions((sessions) => sessions.byId[sessionId]?.cwd)
        : undefined
      const navRevision = tab && tab.navigation ? tab.navigation.revision : 0

      const [path, setPath] = useState(paramPath)
      const [state, setState] = useState({
        loading: true,
        entries: [],
        parent: undefined,
        root: undefined,
        truncated: false,
        error: null,
      })
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [createKind, setCreateKind] = useState(null)
      const [createName, setCreateName] = useState('')
      const [renamePath, setRenamePath] = useState(null)
      const [renameName, setRenameName] = useState('')
      const [deletePath, setDeletePath] = useState(null)
      const createInput = useRef(null)
      const renameInput = useRef(null)
      const noticeTimer = useRef(undefined)

      const notify = useCallback((kind, text) => {
        if (noticeTimer.current !== undefined) clearTimeout(noticeTimer.current)
        setNotice({ kind, text })
        if (kind === 'ok') {
          noticeTimer.current = setTimeout(() => setNotice(null), 4000)
        }
      }, [])

      useEffect(
        () => () => {
          if (noticeTimer.current !== undefined) clearTimeout(noticeTimer.current)
        },
        [],
      )

      const load = useCallback(
        async (target) => {
          if (typeof sessionId !== 'string' || typeof target !== 'string' || target === '') {
            setState({
              loading: false,
              entries: [],
              parent: undefined,
              root: undefined,
              truncated: false,
              error: { code: 'NO_SESSION', message: '' },
            })
            return
          }
          setState((prev) => ({ ...prev, loading: true, error: null }))
          try {
            const data = await postJson(`${PREFIX}/list`, { sessionId, path: target })
            setState({
              loading: false,
              entries: Array.isArray(data.entries) ? data.entries : [],
              parent: typeof data.parent === 'string' ? data.parent : undefined,
              root: typeof data.workspaceRoot === 'string' ? data.workspaceRoot : undefined,
              truncated: data.truncated === true,
              error: null,
            })
          } catch (error) {
            setState((prev) => ({ ...prev, loading: false, error }))
          }
        },
        [sessionId],
      )

      // A fresh open (new params/revision) re-targets the manager; the workspace
      // cwd is the fallback for a manager opened from outside the Files tab.
      useEffect(() => {
        if (paramPath !== undefined) setPath(paramPath)
      }, [paramPath, navRevision])
      useEffect(() => {
        if (path === undefined && typeof cwd === 'string') setPath(cwd)
      }, [cwd, path])
      useEffect(() => {
        if (path !== undefined) load(path)
      }, [path, load])
      useEffect(() => {
        if (createKind !== null && createInput.current !== null) createInput.current.focus()
      }, [createKind])
      useEffect(() => {
        if (renamePath !== null && renameInput.current !== null) {
          renameInput.current.focus()
          renameInput.current.select()
        }
      }, [renamePath])

      const resetTransient = () => {
        setCreateKind(null)
        setRenamePath(null)
        setDeletePath(null)
        setNotice(null)
      }

      const navigate = (next) => {
        resetTransient()
        // Drop the previous directory's rows immediately; the load below fills
        // the new level, so a navigation never shows the old listing meanwhile.
        setState((prev) => ({ ...prev, entries: [], loading: true, error: null }))
        setPath(next)
      }

      const openInEditor = (target) => {
        try {
          const address = sessionFileAddress(sessionId, target)
          const editorParams = { sessionId, absolutePath: target }
          if (tab && tab.actions) {
            tab.actions.openResource(address, { kind: KIND, params: editorParams })
          } else {
            ctx.sidebarRight.openResource(address, { kind: KIND, params: editorParams })
          }
        } catch (error) {
          console.warn('[dsh-sidebar-editor] could not open the editor for', target, error)
        }
      }

      const openEntry = (entry) => {
        if (entry.type === 'directory') navigate(entry.path)
        else if (entry.type === 'file') openInEditor(entry.path)
      }

      const submitCreate = async () => {
        const kind = createKind
        if (kind === null) return
        const name = createName.trim()
        if (!validName(name)) {
          notify('err', tr('manager.invalidName'))
          return
        }
        if (typeof path !== 'string') return
        const target = joinName(path, name)
        setBusy(true)
        try {
          await postJson(`${PREFIX}/${kind === 'directory' ? 'mkdir' : 'create'}`, {
            sessionId,
            path: target,
          })
          setCreateKind(null)
          setCreateName('')
          notify('ok', tr('manager.created', { name }))
          await load(path)
          if (kind === 'file') openInEditor(target)
        } catch (error) {
          notify('err', tr('manager.failed', { message: messageOf(error, tr) }))
        } finally {
          setBusy(false)
        }
      }

      const submitRename = async (entry) => {
        const name = renameName.trim()
        if (!validName(name)) {
          notify('err', tr('manager.invalidName'))
          return
        }
        if (name === entry.name) {
          setRenamePath(null)
          return
        }
        const to = joinName(dirnameOf(entry.path), name)
        setBusy(true)
        try {
          await postJson(`${PREFIX}/rename`, { sessionId, from: entry.path, to })
          setRenamePath(null)
          notify('ok', tr('manager.renamed'))
          await load(path)
        } catch (error) {
          notify('err', tr('manager.failed', { message: messageOf(error, tr) }))
        } finally {
          setBusy(false)
        }
      }

      const submitDelete = async (entry) => {
        setBusy(true)
        try {
          await postJson(`${PREFIX}/delete`, { sessionId, path: entry.path })
          setDeletePath(null)
          notify('ok', tr('manager.deleted', { name: entry.name }))
          await load(path)
        } catch (error) {
          notify('err', tr('manager.failed', { message: messageOf(error, tr) }))
        } finally {
          setBusy(false)
        }
      }

      const atRoot = samePathValue(path, state.root)
      const canUp =
        typeof state.parent === 'string' &&
        !atRoot &&
        isInsidePath(state.root, state.parent)
      const displayPath = displayPathOf(path, state.root)

      const toolbar = h('div', { className: 'sbm-bar', key: 'bar' }, [
        h(
          'button',
          {
            key: 'up',
            type: 'button',
            className: 'sbm-iconbtn',
            title: tr('manager.up'),
            'aria-label': tr('manager.up'),
            disabled: !canUp || busy,
            onClick: () => {
              if (canUp) navigate(state.parent)
            },
          },
          h(ChevronUpIcon, { size: 15 }),
        ),
        h('span', { key: 'path', className: 'sbm-path', title: path ?? '' }, displayPath || (path ?? '')),
        h(
          'button',
          {
            key: 'refresh',
            type: 'button',
            className: 'sbm-iconbtn',
            title: tr('manager.refresh'),
            'aria-label': tr('manager.refresh'),
            disabled: state.loading || busy,
            onClick: () => load(path),
          },
          h(RefreshIcon, { size: 14 }),
        ),
        h(
          'button',
          {
            key: 'new-file',
            type: 'button',
            className: 'sbe-open',
            title: tr('manager.newFile'),
            disabled: typeof path !== 'string' || busy,
            onClick: () => {
              setCreateKind('file')
              setCreateName('')
              setRenamePath(null)
              setDeletePath(null)
            },
          },
          [h(PlusIcon, { key: 'i', size: 13 }), h('span', { key: 'l' }, tr('manager.newFile'))],
        ),
        h(
          'button',
          {
            key: 'new-folder',
            type: 'button',
            className: 'sbe-open',
            title: tr('manager.newFolder'),
            disabled: typeof path !== 'string' || busy,
            onClick: () => {
              setCreateKind('directory')
              setCreateName('')
              setRenamePath(null)
              setDeletePath(null)
            },
          },
          [h(FolderPlusIcon, { key: 'i', size: 13 }), h('span', { key: 'l' }, tr('manager.newFolder'))],
        ),
      ])

      const createRow =
        createKind === null
          ? null
          : h('div', { className: 'sbm-create', key: 'create' }, [
              createKind === 'directory' ? h(FolderIcon, { key: 'i' }) : h(FileIcon, { key: 'i' }),
              h('input', {
                key: 'input',
                ref: createInput,
                className: 'sbm-input',
                value: createName,
                placeholder: tr('manager.namePlaceholder'),
                onChange: (event) => setCreateName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitCreate()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setCreateKind(null)
                    setCreateName('')
                  }
                },
              }),
              h(
                'button',
                {
                  key: 'create',
                  type: 'button',
                  className: 'sbe-btn sbe-accent',
                  disabled: busy,
                  onClick: submitCreate,
                },
                tr('manager.create'),
              ),
              h(
                'button',
                {
                  key: 'cancel',
                  type: 'button',
                  className: 'sbe-btn',
                  onClick: () => {
                    setCreateKind(null)
                    setCreateName('')
                  },
                },
                tr('manager.cancel'),
              ),
            ])

      const rows = state.entries.map((entry) => {
        const glyph = entry.type === 'directory' ? h(FolderIcon, { key: 'i' }) : h(FileIcon, { key: 'i' })
        if (renamePath === entry.path) {
          return h('div', { className: 'sbm-row', key: entry.path }, [
            glyph,
            h('input', {
              key: 'input',
              ref: renameInput,
              className: 'sbm-input',
              value: renameName,
              onChange: (event) => setRenameName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitRename(entry)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setRenamePath(null)
                }
              },
            }),
            h(
              'button',
              {
                key: 'ok',
                type: 'button',
                className: 'sbe-btn sbe-accent',
                disabled: busy,
                onClick: () => submitRename(entry),
              },
              tr('manager.confirmRename'),
            ),
            h(
              'button',
              { key: 'cancel', type: 'button', className: 'sbe-btn', onClick: () => setRenamePath(null) },
              tr('manager.cancel'),
            ),
          ])
        }
        if (deletePath === entry.path) {
          return h('div', { className: 'sbm-row', key: entry.path }, [
            glyph,
            h('span', { key: 'q', className: 'sbm-name' }, tr(
              entry.type === 'directory' ? 'manager.deleteFolderQuestion' : 'manager.deleteQuestion',
              { name: entry.name },
            )),
            h(
              'button',
              {
                key: 'ok',
                type: 'button',
                className: 'sbe-btn sbe-danger',
                disabled: busy,
                onClick: () => submitDelete(entry),
              },
              tr('manager.confirmDelete'),
            ),
            h(
              'button',
              { key: 'cancel', type: 'button', className: 'sbe-btn', onClick: () => setDeletePath(null) },
              tr('manager.cancel'),
            ),
          ])
        }
        return h('div', { className: 'sbm-row', key: entry.path }, [
          h(
            'button',
            {
              key: 'main',
              type: 'button',
              className: 'sbm-main',
              title: entry.path,
              onClick: () => openEntry(entry),
            },
            [
              glyph,
              h('span', { key: 'name', className: 'sbm-name' }, entry.name),
              entry.type === 'file'
                ? h('span', { key: 'size', className: 'sbm-size' }, formatBytes(entry.size))
                : null,
            ],
          ),
          h('span', { key: 'actions', className: 'sbm-actions' }, [
            h(
              'button',
              {
                key: 'rename',
                type: 'button',
                className: 'sbm-rowbtn',
                title: tr('manager.rename'),
                'aria-label': tr('manager.rename'),
                disabled: busy,
                onClick: () => {
                  setRenamePath(entry.path)
                  setRenameName(entry.name)
                  setDeletePath(null)
                  setCreateKind(null)
                },
              },
              h(PencilIcon, { size: 13 }),
            ),
            h(
              'button',
              {
                key: 'delete',
                type: 'button',
                className: 'sbm-rowbtn sbm-danger',
                title: tr('manager.delete'),
                'aria-label': tr('manager.delete'),
                disabled: busy,
                onClick: () => {
                  setDeletePath(entry.path)
                  setRenamePath(null)
                  setCreateKind(null)
                },
              },
              h(TrashIcon, { size: 13 }),
            ),
          ]),
        ])
      })

      let content
      if (state.error !== null) {
        const message =
          state.error.code === 'NO_SESSION' ? tr('manager.noSession') : messageOf(state.error, tr)
        content = h('div', { className: 'sbe-center', key: 'error' }, [
          h('span', { key: 'message' }, message),
          state.error.code === 'NO_SESSION'
            ? null
            : h(
                'button',
                {
                  key: 'retry',
                  type: 'button',
                  className: 'sbe-btn',
                  onClick: () => load(path),
                },
                tr('editor.retry'),
              ),
        ])
      } else if (state.loading && state.entries.length === 0) {
        content = h('div', { className: 'sbe-center', key: 'loading' }, [
          h('span', { key: 'spinner', className: 'sbe-spinner' }),
          h('span', { key: 'label' }, tr('manager.loading')),
        ])
      } else if (state.entries.length === 0) {
        content = h('div', { className: 'sbm-empty', key: 'empty' }, tr('manager.empty'))
      } else {
        content = h('div', { className: 'sbm-list', key: 'list' }, rows)
      }

      const noticeView =
        notice === null
          ? null
          : h('div', { className: `sbe-note sbe-${notice.kind}`, key: 'notice' }, h('span', null, notice.text))

      return h('div', { className: 'sbm-root' }, [
        toolbar,
        createRow,
        noticeView,
        content,
        h('div', { className: 'sbm-status', key: 'status' }, [
          h('span', { key: 'count' }, tr('manager.items', { count: state.entries.length })),
          state.truncated ? h('span', { key: 'truncated' }, tr('manager.truncated')) : null,
          h('span', { key: 'path', className: 'sbm-right', title: path ?? '' }, path ?? ''),
        ]),
      ])
    }

    function ManagerTitle(props) {
      const tr = props.t ?? translate
      return h('span', { className: 'sbe-title' }, [
        h(FolderIcon, { key: 'i', size: 12 }),
        h('span', { key: 'n' }, tr('manager.title')),
      ])
    }

    // ---------------------------------------------------------------------
    // Git panel (status / clone / init / fetch / pull / commit / push)
    // ---------------------------------------------------------------------

    function deriveCloneDirectory(url) {
      const cleaned = String(url).replace(/[\\/]+$/, '').replace(/\.git$/i, '')
      const at = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf(':'))
      const name = cleaned.slice(at + 1).replace(/[^A-Za-z0-9._-]/g, '-')
      return name === '' ? 'repo' : name
    }

    function openGitPanel(sessionId, absolutePath) {
      try {
        ctx.sidebarRight.openTab(GIT_KIND, { params: { sessionId, absolutePath } })
      } catch (error) {
        console.error('[dsh-sidebar-editor] could not open the git panel', error)
      }
    }

    /** Header action on the Files tab: open the Git panel at the displayed directory. */
    function GitAction(props) {
      const tr = props.t ?? translate
      if (typeof props.sessionId !== 'string' || typeof props.absolutePath !== 'string') return null
      const onClick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        openGitPanel(props.sessionId, props.absolutePath)
      }
      return h(
        'button',
        {
          type: 'button',
          className: 'sbe-open',
          title: tr('git.actionHint'),
          'aria-label': tr('git.actionHint'),
          onClick,
        },
        [h(BranchIcon, { key: 'i', size: 13 }), h('span', { key: 'l' }, tr('git.action'))],
      )
    }

    function GitBody(props) {
      const tr = props.t ?? translate
      const tabInfo = props.useTabInfo ? props.useTabInfo() : undefined
      const tab = tabInfo ? tabInfo.tab : undefined
      const params = (tab && tab.navigation && tab.navigation.params) || {}
      const paramPath = typeof params.absolutePath === 'string' ? params.absolutePath : undefined
      const paramSession = typeof params.sessionId === 'string' ? params.sessionId : undefined
      const sessionId = paramSession ?? props.sessionId
      const cwd = props.useSessions
        ? props.useSessions((sessions) => sessions.byId[sessionId]?.cwd)
        : undefined
      const navRevision = tab && tab.navigation ? tab.navigation.revision : 0

      const [repoPath, setRepoPath] = useState(paramPath)
      const [status, setStatus] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [message, setMessage] = useState('')
      const [cloneOpen, setCloneOpen] = useState(false)
      const [cloneUrl, setCloneUrl] = useState('')
      const [cloneDir, setCloneDir] = useState('')
      // Paths the user unticked; everything else stays selected by default.
      const [deselected, setDeselected] = useState(() => new Set())
      const noticeTimer = useRef(undefined)

      const notify = useCallback((kind, text) => {
        if (noticeTimer.current !== undefined) clearTimeout(noticeTimer.current)
        setNotice({ kind, text })
        if (kind === 'ok') noticeTimer.current = setTimeout(() => setNotice(null), 5000)
      }, [])

      useEffect(
        () => () => {
          if (noticeTimer.current !== undefined) clearTimeout(noticeTimer.current)
        },
        [],
      )

      const load = useCallback(
        async (target) => {
          if (typeof sessionId !== 'string' || typeof target !== 'string' || target === '') {
            setLoading(false)
            setError({ code: 'NO_SESSION', message: '' })
            return
          }
          setLoading(true)
          setError(null)
          try {
            const data = await postJson(`${PREFIX}/git/status`, { sessionId, path: target })
            setStatus(data.status)
          } catch (err) {
            setError(err)
          } finally {
            setLoading(false)
          }
        },
        [sessionId],
      )

      useEffect(() => {
        if (paramPath !== undefined) setRepoPath(paramPath)
      }, [paramPath, navRevision])
      useEffect(() => {
        if (repoPath === undefined && typeof cwd === 'string') setRepoPath(cwd)
      }, [cwd, repoPath])
      useEffect(() => {
        if (repoPath !== undefined) load(repoPath)
      }, [repoPath, load])
      // A different repository starts with every change ticked again.
      useEffect(() => {
        setDeselected(new Set())
      }, [repoPath])

      const run = async (action, payload, doneKey) => {
        setBusy(true)
        setNotice(null)
        try {
          const data = await postJson(`${PREFIX}/git/${action}`, {
            sessionId,
            path: repoPath,
            ...(payload || {}),
          })
          if (data.status) setStatus(data.status)
          if (action === 'clone' && typeof data.absolutePath === 'string') {
            setRepoPath(data.absolutePath)
            setCloneOpen(false)
            setCloneUrl('')
            setCloneDir('')
          }
          notify(
            'ok',
            tr(
              doneKey,
              action === 'clone' && typeof data.absolutePath === 'string'
                ? { path: data.absolutePath }
                : {},
            ),
          )
          return data
        } catch (err) {
          notify('err', tr('git.failed', { message: messageOf(err, tr) }))
          return undefined
        } finally {
          setBusy(false)
        }
      }

      const submitCommit = async () => {
        if (message.trim() === '') {
          notify('err', tr('git.errEmptyMessage'))
          return
        }
        const selected = (status?.changes ?? [])
          .filter((change) => !deselected.has(change.path))
          .map((change) => change.path)
        if (selected.length === 0) {
          notify('err', tr('git.errNoSelection'))
          return
        }
        const data = await run('commit', { message, paths: selected }, 'git.commitDone')
        if (data !== undefined) setMessage('')
      }

      const submitClone = async () => {
        const url = cloneUrl.trim()
        if (url === '') {
          notify('err', tr('git.errInvalidUrl'))
          return
        }
        const directory = cloneDir.trim() || deriveCloneDirectory(url)
        await run('clone', { url, directory }, 'git.cloneDone')
      }

      const isRepo = status !== null && status.isRepo === true
      const changes = isRepo ? status.changes : []
      const ahead = isRepo ? status.ahead : 0
      const behind = isRepo ? status.behind : 0
      const selectedCount = changes.reduce(
        (count, change) => count + (deselected.has(change.path) ? 0 : 1),
        0,
      )
      const allSelected = changes.length > 0 && selectedCount === changes.length
      const toggleChange = (path) => {
        setDeselected((current) => {
          const next = new Set(current)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
      }
      const toggleAll = () => {
        setDeselected(allSelected ? new Set(changes.map((change) => change.path)) : new Set())
      }
      const branchName = isRepo
        ? status.detached
          ? tr('git.detached')
          : status.branch ?? '—'
        : tr('git.title')

      const toolbar = h('div', { className: 'sbg-bar', key: 'bar' }, [
        h('span', { key: 'branch', className: 'sbg-branch', title: branchName }, [
          h(BranchIcon, { key: 'i', size: 14 }),
          h('span', { key: 'n' }, branchName),
        ]),
        isRepo && status.upstream === null
          ? h('span', { key: 'upstream', className: 'sbg-badge' }, tr('git.noUpstream'))
          : null,
        isRepo && ahead > 0
          ? h('span', { key: 'ahead', className: 'sbg-badge ahead' }, tr('git.ahead', { n: ahead }))
          : null,
        isRepo && behind > 0
          ? h('span', { key: 'behind', className: 'sbg-badge behind' }, tr('git.behind', { n: behind }))
          : null,
        h('span', { key: 'spacer', className: 'sbg-spacer' }),
        h(
          'button',
          {
            key: 'workspace',
            type: 'button',
            className: 'sbm-iconbtn',
            title: tr('git.workspace'),
            'aria-label': tr('git.workspace'),
            disabled: busy || typeof cwd !== 'string',
            onClick: () => {
              setRepoPath(cwd)
              setCloneOpen(false)
            },
          },
          h(FolderIcon, { size: 14 }),
        ),
        h(
          'button',
          {
            key: 'refresh',
            type: 'button',
            className: 'sbm-iconbtn',
            title: tr('git.refresh'),
            'aria-label': tr('git.refresh'),
            disabled: loading || busy,
            onClick: () => load(repoPath),
          },
          h(RefreshIcon, { size: 14 }),
        ),
        isRepo
          ? h(
              'button',
              {
                key: 'fetch',
                type: 'button',
                className: 'sbm-iconbtn',
                title: tr('git.fetch'),
                'aria-label': tr('git.fetch'),
                disabled: busy,
                onClick: () => run('fetch', {}, 'git.fetchDone'),
              },
              h(ArrowDownIcon, { size: 14 }),
            )
          : null,
        isRepo
          ? h(
              'button',
              {
                key: 'pull',
                type: 'button',
                className: 'sbm-iconbtn',
                title: tr('git.pull'),
                'aria-label': tr('git.pull'),
                disabled: busy,
                onClick: () => run('pull', {}, 'git.pullDone'),
              },
              h(PullIcon, { size: 14 }),
            )
          : null,
        isRepo
          ? h(
              'button',
              {
                key: 'push',
                type: 'button',
                className: 'sbm-iconbtn',
                title: tr('git.push'),
                'aria-label': tr('git.push'),
                disabled: busy,
                onClick: () => run('push', {}, 'git.pushDone'),
              },
              h(PushIcon, { size: 14 }),
            )
          : null,
      ])

      const noticeView =
        notice === null
          ? null
          : h('div', { className: `sbe-note sbe-${notice.kind}`, key: 'notice' }, h('span', null, notice.text))

      let content
      if (loading && status === null) {
        content = h('div', { className: 'sbe-center', key: 'loading' }, [
          h('span', { key: 'spinner', className: 'sbe-spinner' }),
          h('span', { key: 'label' }, tr('git.loading')),
        ])
      } else if (error !== null) {
        content = h('div', { className: 'sbe-center', key: 'error' }, [
          h(
            'span',
            { key: 'message' },
            error.code === 'NO_SESSION' ? tr('git.noSession') : messageOf(error, tr),
          ),
          h(
            'button',
            { key: 'retry', type: 'button', className: 'sbe-btn', onClick: () => load(repoPath) },
            tr('editor.retry'),
          ),
        ])
      } else if (!isRepo) {
        content = h('div', { className: 'sbg-center', key: 'no-repo' }, [
          h('div', { className: 'sbg-card' }, [
            h(BranchIcon, { key: 'icon', size: 24 }),
            h('div', { key: 'title', className: 'sbg-card-title' }, tr('git.noRepo')),
            h('div', { key: 'path', className: 'sbg-card-path', title: repoPath ?? '' }, repoPath ?? ''),
            h('div', { key: 'hint', className: 'sbg-card-hint' }, tr('git.noRepoHint')),
            h('div', { key: 'actions', style: { display: 'flex', gap: 6, justifyContent: 'center' } }, [
              h(
                'button',
                {
                  key: 'init',
                  type: 'button',
                  className: 'sbe-btn sbe-accent',
                  disabled: busy,
                  onClick: () => run('init', {}, 'git.initDone'),
                },
                tr('git.init'),
              ),
              h(
                'button',
                {
                  key: 'clone',
                  type: 'button',
                  className: 'sbe-btn',
                  disabled: busy,
                  onClick: () => setCloneOpen(!cloneOpen),
                },
                tr('git.clone'),
              ),
            ]),
            cloneOpen
              ? h('div', { key: 'clone-form', className: 'sbg-clone-form' }, [
                  h('input', {
                    key: 'url',
                    className: 'sbg-input',
                    placeholder: tr('git.cloneUrl'),
                    value: cloneUrl,
                    onChange: (event) => setCloneUrl(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitClone()
                      }
                    },
                  }),
                  h('input', {
                    key: 'dir',
                    className: 'sbg-input',
                    placeholder: tr('git.cloneDir'),
                    value: cloneDir,
                    onChange: (event) => setCloneDir(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitClone()
                      }
                    },
                  }),
                  h('div', { key: 'buttons', className: 'sbg-actions' }, [
                    h(
                      'button',
                      {
                        key: 'cancel',
                        type: 'button',
                        className: 'sbe-btn',
                        onClick: () => {
                          setCloneOpen(false)
                          setCloneUrl('')
                          setCloneDir('')
                        },
                      },
                      tr('git.cancel'),
                    ),
                    h(
                      'button',
                      {
                        key: 'go',
                        type: 'button',
                        className: 'sbe-btn sbe-accent',
                        disabled: busy,
                        onClick: submitClone,
                      },
                      tr('git.cloneDo'),
                    ),
                  ]),
                ])
              : null,
          ]),
        ])
      } else {
        const head = h('div', { key: 'head', className: 'sbg-repo-head' }, [
          h('span', { key: 'path', className: 'sbg-repo-path', title: status.root ?? '' }, status.root ?? ''),
          h(
            'span',
            { key: 'commit', className: 'sbg-repo-commit', title: status.lastCommit?.subject ?? '' },
            status.lastCommit === null
              ? tr('git.noCommit')
              : `${status.lastCommit.hash} ${status.lastCommit.subject}`,
          ),
        ])
        const section = h('div', { key: 'section', className: 'sbg-section' }, [
          h('span', { key: 'label' }, tr('git.changes', { n: changes.length })),
          status.remotes.length > 0
            ? h(
                'span',
                { key: 'remote', style: { fontWeight: 400 } },
                `· ${status.remotes.map((remote) => remote.name).join(', ')}`,
              )
            : null,
          h('span', { key: 'spacer', className: 'sbg-spacer' }),
          changes.length > 0
            ? h(
                'span',
                { key: 'selected', className: 'sbg-selected' },
                tr('git.selected', { n: selectedCount, total: changes.length }),
              )
            : null,
          changes.length > 0
            ? h(
                'button',
                {
                  key: 'pickall',
                  type: 'button',
                  className: 'sbg-link',
                  disabled: busy,
                  onClick: toggleAll,
                },
                allSelected ? tr('git.selectNone') : tr('git.selectAll'),
              )
            : null,
        ])
        const rows =
          changes.length === 0
            ? [
                h('div', { key: 'clean', className: 'sbg-clean' }, [
                  h(CheckIcon, { key: 'icon', size: 14 }),
                  h('span', { key: 'label' }, ` ${tr('git.clean')}`),
                ]),
              ]
            : changes.map((change) =>
                h(
                  'label',
                  {
                    className: 'sbg-change',
                    key: `${change.path}:${change.from ?? ''}`,
                    title: tr('git.pick'),
                  },
                  [
                    h('input', {
                      key: 'pick',
                      type: 'checkbox',
                      className: 'sbg-pick',
                      checked: !deselected.has(change.path),
                      disabled: busy,
                      'aria-label': change.path,
                      onChange: () => toggleChange(change.path),
                    }),
                    h(
                      'span',
                      { key: 'code', className: `sbg-code is-${change.status}` },
                      `${change.index}${change.worktree}`.trim() || '?',
                    ),
                    h('span', { key: 'path', className: 'sbg-change-path', title: change.path }, change.path),
                    change.from === undefined
                      ? null
                      : h(
                          'span',
                          { key: 'from', className: 'sbg-change-from', title: change.from },
                          `← ${change.from}`,
                        ),
                  ],
                ),
              )
        content = h('div', { className: 'sbg-list', key: 'repo' }, [head, section, ...rows])
      }

      const commitBar = !isRepo
        ? null
        : h('div', { className: 'sbg-commit', key: 'commit' }, [
            h('input', {
              key: 'message',
              className: 'sbg-input',
              placeholder: tr('git.commitPlaceholder'),
              value: message,
              onChange: (event) => setMessage(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitCommit()
                }
              },
            }),
            h(
              'button',
              {
                key: 'commit',
                type: 'button',
                className: 'sbe-btn sbe-accent',
                disabled: busy || selectedCount === 0 || message.trim() === '',
                onClick: submitCommit,
              },
              busy
                ? tr('git.committing')
                : allSelected
                  ? tr('git.commit')
                  : tr('git.commitSelected', { n: selectedCount }),
            ),
          ])

      return h('div', { className: 'sbg-root' }, [
        toolbar,
        noticeView,
        content,
        commitBar,
        h('div', { className: 'sbg-status', key: 'status' }, [
          h('span', { key: 'branch' }, isRepo ? `${tr('git.branch')}: ${branchName}` : tr('git.noRepo')),
          h('span', { key: 'path', className: 'sbg-right', title: repoPath ?? '' }, repoPath ?? ''),
        ]),
      ])
    }

    function GitTitle(props) {
      const tr = props.t ?? translate
      return h('span', { className: 'sbe-title' }, [
        h(BranchIcon, { key: 'i', size: 12 }),
        h('span', { key: 'n' }, tr('git.title')),
      ])
    }

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------

    /** Required browser services: slots, copy, and the right Sidebar's two faces. */
    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']

    let ctx

    function apply(context) {
      ctx = context
      const t = ctx.locale.bind(NS)
      translate = t

      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = 'dsh-sidebar-editor-styles'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'sidebar-editor: styles')

      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'sidebar-editor: dictionaries',
      )

      // A page-less resource type: it claims no glob, so only the explicit
      // `kind` from the Edit action opens it, and it never competes with the
      // shipped preview for a file click.
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: ID,
            kind: KIND,
            priority: 'extension',
            title: (address) => {
              const parsed = parseFileAddress(address)
              return basenameOf(parsed?.path) || t('type.label')
            },
          }),
        'sidebar-editor: tab type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: ID, locale: NS },
              EditorBody,
            ),
          ),
        'sidebar-editor: editor body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: ID, locale: NS },
              EditorTitle,
            ),
          ),
        'sidebar-editor: chip title',
      )

      // Page type for the file manager. It claims no address; the Files tab's
      // header action opens it at that tab's displayed directory.
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: MANAGER_ID,
            kind: MANAGER_KIND,
            priority: 'extension',
            title: () => t('manager.title'),
          }),
        'sidebar-editor: manager type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: MANAGER_ID, locale: NS },
              ManagerBody,
            ),
          ),
        'sidebar-editor: manager body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: MANAGER_ID, locale: NS },
              ManagerTitle,
            ),
          ),
        'sidebar-editor: manager title',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.tab.files.actions', () =>
            ctx.slots.register(
              { name: 'sidebar.right.tab.files.actions', id: `${ID}-manage`, order: 5, locale: NS },
              ManageAction,
            ),
          ),
        'sidebar-editor: manage action',
      )

      // Page type for the Git panel, opened from the same Files-tab header.
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: GIT_ID,
            kind: GIT_KIND,
            priority: 'extension',
            title: () => t('git.title'),
          }),
        'sidebar-editor: git type',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: GIT_ID, locale: NS },
              GitBody,
            ),
          ),
        'sidebar-editor: git body',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab.title', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: GIT_ID, locale: NS },
              GitTitle,
            ),
          ),
        'sidebar-editor: git title',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.tab.files.actions', () =>
            ctx.slots.register(
              { name: 'sidebar.right.tab.files.actions', id: `${ID}-git`, order: 6, locale: NS },
              GitAction,
            ),
          ),
        'sidebar-editor: git action',
      )

      // The preview header button, plus the empty state shown when the preview
      // cannot render a text file (for example one that exceeds its page sizes).
      for (const slot of ['sidebar.right.tab.document.actions', 'sidebar.right.tab.document.unpreviewable']) {
        ctx.effect(
          () =>
            ctx.slots.inject(slot, () =>
              ctx.slots.register(
                { name: slot, id: `${ID}-open`, order: 10, locale: NS },
                EditAction,
              ),
            ),
          `sidebar-editor: open action in ${slot}`,
        )
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.EditorBody = EditorBody
    exports.ManagerBody = ManagerBody
    exports.GitBody = GitBody
    return module.exports
  },
})
