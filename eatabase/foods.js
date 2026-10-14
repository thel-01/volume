import { $, pageHeader, navRow, escapeHtml, status, toast, run, arm, field, fieldError, readNumber } from './ui.js';
import { NUTRIENTS } from './nutrition.js';
import * as store from './store.js';
let foods = [], editing;
const meta = f => f.basis === 'portion' ? 'Saved meal · per portion' : `Per 100 g${f.brand ? ` · ${f.brand}` : ''}`;
async function load() {
  editing = null; pageHeader('Your foods','./settings.html','Back to settings');
  try {
    const deleted = await store.listDeletedFoods(); foods = await store.listFoods();
    $('foods-content').innerHTML = foods.length ? `<ul class="list">${foods.map(f => navRow(f.name,meta(f),`#${encodeURIComponent(f.id)}`)).join('')}</ul>` : '<p class="empty-state">No foods saved yet.</p>';
    $('foods-content').querySelectorAll('a').forEach((a,i) => a.onclick = e => { e.preventDefault(); openEdit(foods[i]); });
    if (deleted.length) {
      $('foods-content').insertAdjacentHTML('beforeend', `<p class="section-label">Recently deleted</p><p class="caption">Foods can be restored for 30 days after deletion.</p><ul class="list">${deleted.map(f => `<li class="list-item"><div class="list-item-body"><div class="list-item-name">${escapeHtml(f.name)}</div><div class="list-item-meta">${escapeHtml(meta(f))}</div></div><button type="button" class="restore-food link-button" data-id="${escapeHtml(f.id)}">Restore</button></li>`).join('')}</ul>`);
      $('foods-content').querySelectorAll('.restore-food').forEach(b => b.onclick = () => run(b,async () => { await store.restoreFood(b.dataset.id); await load(); toast('Food restored'); }));
    }
    $('foods-content').hidden = false; status('page-status');
  } catch { status('page-status', "Couldn't load your foods.",'error',load); }
}
function openEdit(food) {
  editing = food; pageHeader('Edit food','#','Back to your foods');
  $('page-header').querySelector('a').onclick = e => { e.preventDefault(); load(); };
  const per100 = food.basis === 'per100', values = per100 ? food.per100 : food.portion;
  $('foods-content').innerHTML = `${field('food-name','Name · required',food.name,{mode:'text',required:true, maxlength: 120})}${per100 ? field('food-brand','Brand (optional)',food.brand || '',{mode:'text', maxlength: 80}) + field('food-barcode','Barcode (optional)',food.barcode || '',{mode:'numeric', maxlength: 14}) : ''}<p class="section-label">${per100 ? 'Per 100 g' : 'Per portion'}</p>${NUTRIENTS.map(n => field(`food-${n.key}`,`${n.label} (${n.unit})`,values?.[n.key] ?? '',{required:true})).join('')}<button type="button" id="save-food">Save</button><div class="form-delete"><button type="button" class="arm-confirm-btn" id="delete-food">Delete</button></div>`;
  $('save-food').onclick = e => run(e.currentTarget, async () => {
    const name = $('food-name').value.trim(), barcode = per100 ? $('food-barcode').value.trim() : null;
    fieldError('food-name',!name ? 'Enter the food name.' : name.length > 120 ? 'Use no more than 120 characters.' : '');
    const brand = per100 ? $('food-brand').value.trim() : '';
    if (per100) fieldError('food-brand',brand.length > 80 ? 'Use no more than 80 characters.' : '');
    const barcodeValid = !barcode || /^\d{8,14}$/.test(barcode);
    if (per100) fieldError('food-barcode',barcodeValid ? '' : 'Use 8–14 digits for the barcode.');
    let valid = !!name && name.length <= 120 && brand.length <= 80 && barcodeValid; const values = {};
    for (const n of NUTRIENTS) {
      const r = readNumber(`food-${n.key}`,{required:true,max:per100 ? (n.key === 'kcal' ? 1000 : 100) : (n.key === 'kcal' ? 10000 : 1000)});
      values[n.key] = r.value; if (r.error) valid = false;
    }
    if (!valid) { $('foods-content').querySelector('[aria-invalid="true"]')?.focus(); return; }
    await store.updateFood(food.id,{name,...(per100 ? {brand:$('food-brand').value.trim() || null,barcode:barcode || null,per100:values} : {portion:values})});
    await load(); toast('Food saved');
  });
  arm($('delete-food'),async () => {
    await store.deleteFood(food.id); await load();
    toast('Food deleted',async () => { await store.restoreFood(food.id); await load(); });
  });
  window.scrollTo(0,0);
}
load();
