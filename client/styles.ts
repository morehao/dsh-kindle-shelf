/** 客户端样式：一次性注入，全部类名以 `dshk-` 前缀隔离，颜色走宿主 token。 */
export const STYLE_ID = 'dsh-kindle-shelf-style';

export const CSS = `
.dshk-root{--k-fg:var(--dsw-alias-label-primary,#1f2328);--k-muted:var(--dsw-alias-label-secondary,#6b7280);--k-bg:var(--dsw-alias-bg-base,#fff);--k-card:var(--dsw-alias-bg-layer-1,#f8fafc);--k-border:var(--dsw-alias-border-l2,#e5e7eb);--k-accent:var(--dsw-alias-state-business-primary,#2563eb);--k-ok:var(--dsw-alias-state-success-primary,#16a34a);--k-warn:var(--dsw-alias-state-warn-primary,#d97706);--k-err:var(--dsw-alias-state-error-primary,#dc2626);color:var(--k-fg);font-size:14px;line-height:1.55;display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;}
.dshk-root *{box-sizing:border-box;}
.dshk-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.dshk-title{font-size:16px;font-weight:650;white-space:nowrap;}
.dshk-sub{color:var(--k-muted);font-size:12px;}
.dshk-spacer{margin-left:auto;}
.dshk-tabs{display:flex;gap:4px;border-bottom:1px solid var(--k-border);flex:none;}
.dshk-tab{appearance:none;border:none;background:none;padding:7px 12px;font:inherit;color:var(--k-muted);cursor:pointer;border-bottom:2px solid transparent;}
.dshk-tab[aria-selected="true"]{color:var(--k-fg);border-bottom-color:var(--k-accent);font-weight:600;}
.dshk-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;overflow-y:auto;padding-right:4px;}
.dshk-card{border:1px solid var(--k-border);border-radius:10px;background:var(--k-card);padding:12px 14px;display:flex;flex-direction:column;gap:10px;}
.dshk-card-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dshk-card-h h3{margin:0;font-size:13px;font-weight:600;white-space:nowrap;}
.dshk-hint{color:var(--k-muted);font-size:12px;overflow-wrap:anywhere;}
.dshk-row{display:flex;gap:10px;align-items:center;min-height:28px;flex-wrap:wrap;}
.dshk-label{width:104px;flex:none;color:var(--k-muted);font-size:12px;}
.dshk-input,.dshk-select{font:inherit;color:inherit;background:var(--k-bg);border:1px solid var(--k-border);border-radius:7px;padding:5px 8px;min-width:0;}
.dshk-input{min-width:220px;}
.dshk-input:focus,.dshk-select:focus{outline:2px solid color-mix(in srgb,var(--k-accent) 35%,transparent);outline-offset:1px;}
.dshk-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}
.dshk-btn{appearance:none;font:inherit;cursor:pointer;border-radius:7px;border:1px solid var(--k-border);background:var(--k-bg);padding:5px 11px;color:inherit;white-space:nowrap;}
.dshk-btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--k-accent) 45%,var(--k-border));}
.dshk-btn:disabled{opacity:.55;cursor:not-allowed;}
.dshk-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--k-accent));border-color:var(--dsw-alias-button-primary-fill,var(--k-accent));color:var(--dsw-alias-label-primary-foreground,#fff);}
.dshk-btn-danger{background:transparent;border-color:var(--k-err);color:var(--k-err);}
.dshk-btn-ghost{border-color:transparent;background:transparent;color:var(--k-muted);}
.dshk-btn-sm{padding:3px 8px;font-size:12px;}
.dshk-pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--k-border);border-radius:999px;padding:2px 9px;font-size:12px;background:var(--k-bg);}
.dshk-dot{width:7px;height:7px;border-radius:50%;background:var(--k-muted);flex:none;}
.dshk-dot.ok{background:var(--k-ok);} .dshk-dot.warn{background:var(--k-warn);} .dshk-dot.err{background:var(--k-err);}
.dshk-alert{border:1px solid var(--k-border);border-left:3px solid var(--k-warn);border-radius:8px;padding:8px 10px;background:color-mix(in srgb,var(--k-warn) 8%,var(--k-bg));font-size:12px;white-space:pre-wrap;}
.dshk-alert.err{border-left-color:var(--k-err);background:color-mix(in srgb,var(--k-err) 8%,var(--k-bg));}
.dshk-alert.ok{border-left-color:var(--k-ok);background:color-mix(in srgb,var(--k-ok) 8%,var(--k-bg));}
.dshk-empty{padding:26px 12px;text-align:center;color:var(--k-muted);font-size:13px;border:1px dashed var(--k-border);border-radius:10px;}
.dshk-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dshk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px;}
.dshk-book{position:relative;display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--k-border);border-radius:10px;background:var(--k-bg);cursor:pointer;text-align:left;font:inherit;color:inherit;}
.dshk-book:hover{border-color:color-mix(in srgb,var(--k-accent) 40%,var(--k-border));}
.dshk-book[data-selected="true"]{border-color:var(--k-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--k-accent) 25%,transparent);}
.dshk-cover{aspect-ratio:3/4;border-radius:6px;overflow:hidden;background:linear-gradient(135deg,color-mix(in srgb,var(--k-accent) 12%,var(--k-card)),var(--k-card));display:flex;align-items:center;justify-content:center;color:var(--k-muted);font-size:11px;}
.dshk-cover img{width:100%;height:100%;object-fit:cover;display:block;}
.dshk-book-title{font-size:13px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;}
.dshk-book-meta{font-size:11px;color:var(--k-muted);display:flex;gap:6px;flex-wrap:wrap;}
.dshk-tag{border:1px solid var(--k-border);border-radius:5px;padding:0 5px;font-size:10px;text-transform:uppercase;letter-spacing:.03em;}
.dshk-actions{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid var(--k-border);background:var(--k-card);border-radius:10px;}
.dshk-list{display:flex;flex-direction:column;gap:6px;}
.dshk-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--k-border);border-radius:8px;background:var(--k-bg);}
.dshk-item-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.dshk-item-title{font-size:13px;font-weight:500;overflow-wrap:anywhere;}
.dshk-item-sub{font-size:11px;color:var(--k-muted);}
.dshk-progress{height:5px;border-radius:999px;background:color-mix(in srgb,var(--k-accent) 15%,transparent);overflow:hidden;}
.dshk-progress-inner{height:100%;background:var(--k-accent);transition:width .25s ease;}
.dshk-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--k-card);border:1px solid var(--k-border);border-radius:6px;padding:2px 6px;overflow-wrap:anywhere;}
.dshk-url{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;}
.dshk-url a{color:var(--k-accent);font-weight:600;text-decoration:none;overflow-wrap:anywhere;}
.dshk-check{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--k-muted);}
`;
