import './page-init.js';
import { $, pageHeader, escapeHtml, CHEVRON, status, toast } from './ui.js';
import { BACKEND } from './config.js';
import { listClaudeGrants, revokeClaudeGrants } from './oauth-grants.js';
import { copyButtonMarkup, createCopyFeedback, copyText } from '../copy-feedback.js';

const MCP_URL = 'https://zhrlrgzpstipojaopnbo.supabase.co/functions/v1/eatabase-mcp';
const INFO = '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g transform="translate(11 11) scale(1.2) translate(-11 -11)"><g transform="translate(0 -0.144333333)"><path fill="currentColor" stroke="currentColor" stroke-width="40" stroke-linejoin="miter" transform="translate(7.508000 15.236000) scale(0.012 -0.012)" d="M210 220 204 374H242Q326 374 369.5 405.5Q413 437 413 504Q413 555 380.5 586.0Q348 617 291 617Q237 617 204.0 587.5Q171 558 166 508H66Q68 568 95.0 614.0Q122 660 172.0 686.0Q222 712 291 712Q398 712 457.0 656.5Q516 601 516 506Q516 439 486.0 394.5Q456 350 407.5 326.5Q359 303 304 298L301 220Z"/></g><g transform="translate(0 0.144333333)"><path fill="currentColor" stroke="currentColor" stroke-width="40" stroke-linejoin="miter" transform="translate(7.508000 15.236000) scale(0.012 -0.012)" d="M253 -6Q216 -6 190.0 18.5Q164 43 164 78Q164 113 190.0 137.0Q216 161 253 161Q291 161 316.5 137.0Q342 113 342 78Q342 43 316.5 18.5Q291 -6 253 -6Z"/></g></g></svg>';
let grants = [], view = 'list', armed = false, removing = false, refreshing = false;
let supabase, infoFocus, copyFeedback, revision = 0;
const content = $('connectors-content');

function header(title, back) {
  pageHeader(title, back ? '#' : './settings.html', back ? 'Back to AI connectors' : 'Back to settings');
  if (back) $('page-header').querySelector('a').onclick = event => { event.preventDefault(); if (!removing) showView('list'); };
}
function closeInfo() {
  if ($('info-modal').hidden) return;
  $('info-modal').hidden = true; infoFocus?.focus();
}
function render() {
  copyFeedback?.reset(); copyFeedback = null;
  if (view === 'list') {
    header('AI connectors');
    const active = grants.length > 0;
    content.innerHTML = `${active ? '' : `<p class="empty-line">No AI apps connected.<button type="button" class="info-btn" id="connector-info" aria-label="What are AI connectors?">${INFO}</button></p>`}
      <a class="card connector-card" href="#" id="claude-card"><div class="list-item-body"><div class="list-item-name">Claude<span class="badge${active ? ' badge-live' : ''}">${active ? 'Active' : 'Inactive'}</span></div><div class="list-item-meta">By Anthropic</div></div><span class="list-item-chevron">${CHEVRON}</span></a>`;
    $('claude-card').onclick = event => { event.preventDefault(); showView(active ? 'detail' : 'steps'); };
    if ($('connector-info')) $('connector-info').onclick = event => {
      infoFocus = event.currentTarget; $('info-modal').hidden = false; $('close-info').focus();
    };
  } else if (view === 'steps') {
    header('Connect Claude', true);
    content.innerHTML = `<ol class="steps plain">
      <li><p class="step-title">Open Claude’s connector settings.</p><a class="link-button connector-settings-link" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer">claude.ai/settings/connectors ↗</a></li>
      <li><p class="step-title">Add a <b>custom connector</b>. Name it Eatabase and paste this address:</p><div class="import-prompt-box">${copyButtonMarkup('Copy address')}<div class="import-prompt-text">${MCP_URL}</div></div><span id="copy-announcement" class="import-copy-announcement" role="status" aria-live="polite"></span></li>
      <li><p class="step-title">Click <b>Continue</b>, then <b>Add</b>, then <b>Connect</b>. An Eatabase page opens: tap <b>Allow</b>.</p></li>
      <li><p class="step-title">Done. Claude can now log food for you.</p></li>
    </ol>`;
    const button = content.querySelector('.import-copy-button');
    copyFeedback = createCopyFeedback(button, $('copy-announcement'), 'Copy address');
    const feedback = copyFeedback;
    button.onclick = async () => {
      if (button.getAttribute('aria-busy') === 'true') return;
      button.setAttribute('aria-busy', 'true');
      const copied = await copyText(MCP_URL);
      button.removeAttribute('aria-busy');
      if (!button.isConnected) return;
      if (copied) feedback.play();
      else status('page-status', 'Could not copy automatically. Select the address and choose Copy.', 'error');
    };
  } else {
    header('Claude', true);
    const grant = grants.slice().sort((a, b) => Date.parse(a.granted_at) - Date.parse(b.granted_at))[0];
    const date = new Date(grant?.granted_at);
    const connected = Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    content.innerHTML = `<div class="reference-line" style="margin-top:0;"><span class="reference-label">Can:</span><span class="reference-value">Read, add and remove food in your log</span></div>
      <div class="reference-line"><span class="reference-label">Connected:</span><span class="reference-value">${escapeHtml(connected)}</span></div>
      <div class="connector-remove">${armed
        ? `<p class="caption" style="margin-top:0;">Claude won’t be able to see or change your log any more. You can connect again any time.</p><div class="btn-row"><button type="button" class="secondary" id="cancel-remove">Cancel</button><button type="button" class="danger uppercase" id="confirm-remove">Yes, remove</button></div>`
        : '<button type="button" class="secondary danger uppercase" id="remove-connection">Remove connection</button>'}</div>`;
    if (armed) {
      $('cancel-remove').onclick = () => { armed = false; render(); };
      $('confirm-remove').onclick = removeConnection;
    } else $('remove-connection').onclick = () => { armed = true; render(); };
  }
}
function showView(next) {
  closeInfo(); armed = false; view = next; status('page-status'); render();
}
async function refresh() {
  if (!supabase || refreshing || removing) return;
  refreshing = true;
  const current = revision;
  try {
    const next = await listClaudeGrants(supabase);
    if (current !== revision) return;
    const changed = JSON.stringify(next) !== JSON.stringify(grants);
    grants = next; status('page-status');
    if ((view === 'steps' && grants.length) || (view === 'detail' && !grants.length)) showView('list');
    else if (changed || !content.innerHTML) render();
  } catch (error) {
    if (current !== revision) return;
    console.error('Could not load connectors:', error);
    status('page-status', "Couldn't load your connections. Please try again.", 'error');
  } finally { refreshing = false; }
}
async function removeConnection() {
  if (removing) return;
  removing = true; revision++;
  $('confirm-remove').disabled = true; $('cancel-remove').disabled = true;
  status('page-status');
  try {
    await revokeClaudeGrants(supabase);
    grants = []; showView('list'); toast('Connection removed');
  } catch (error) {
    console.error('Could not remove connector:', error);
    status('page-status', "Couldn't remove the connection. Please try again.", 'error');
    $('confirm-remove').disabled = false; $('cancel-remove').disabled = false;
  } finally { removing = false; }
}
$('close-info').onclick = closeInfo;
$('info-modal').onclick = event => { if (event.target === $('info-modal')) closeInfo(); };
document.addEventListener('keydown', event => {
  if ($('info-modal').hidden) return;
  if (event.key === 'Escape') closeInfo();
  if (event.key === 'Tab') { event.preventDefault(); $('close-info').focus(); }
});
window.addEventListener('pageshow', refresh);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
header('AI connectors');
try {
  if (BACKEND !== 'supabase') throw new Error('Connectors require Supabase');
  ({ supabase } = await import('../supabase-client.js'));
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.user || data.session.user.is_anonymous) { location.replace('./settings.html'); }
  else await refresh();
} catch (error) {
  console.error('Could not open connectors:', error);
  status('page-status', "Couldn't load your connections. Please try again.", 'error');
}
