import { setupOpen, setupToken } from '@/lib/setup';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const page = (body: string, js = '') => new Response(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Première configuration</title>
<style>body{font:16px/1.55 system-ui,sans-serif;background:#F1F4EC;color:#10201A;margin:0}main{max-width:520px;margin:0 auto;padding:2rem 1.25rem 4rem}h1{font-size:1.7rem;margin:.2rem 0 .4rem}h2{font-size:1.1rem;margin:1.6rem 0 .2rem}p,small{color:#4F6157}label{display:grid;gap:.3rem;font-weight:600;margin:.9rem 0}input{font:inherit;padding:.75rem .9rem;border:2px solid #C9D4CB;border-radius:12px;background:#fff}small{font-weight:400}button{font:inherit;font-weight:700;background:#0D3B2C;color:#fff;border:0;border-radius:999px;padding:.9rem 1.6rem;cursor:pointer;margin-top:1rem}#err{color:#B3261E;font-weight:600;min-height:1.3em}a{color:#0D3B2C;font-weight:600}</style></head><body><main>${body}</main><script>${js}</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function GET() {
  if (setupToken().length < 12) return page('<h1>Première configuration</h1><p>Ajoutez d\'abord la variable <b>SETUP_TOKEN</b> dans Vercel (Settings, Environment Variables, 12 caractères minimum, par exemple un mot de passe long de votre choix), puis redéployez et revenez sur cette page.</p>');
  let open = false; try { open = await setupOpen(); } catch { return page('<h1>Base de données injoignable</h1><p>Vérifiez la variable <b>DATABASE_URL</b> dans Vercel, puis redéployez.</p>'); }
  if (!open) return page('<h1>Déjà configuré</h1><p>Un compte super-admin existe déjà. Connectez-vous sur <a href="/super/">/super/</a>.</p>');
  return page(`<h1>Première configuration</h1><p>Cette page crée votre compte de gestion (super-admin) et, si vous voulez, votre première boutique. Elle se ferme toute seule ensuite.</p>
<form id="f"><label>Code de configuration<input name="token" type="password" required autocomplete="off"><small>La valeur de SETUP_TOKEN que vous avez mise dans Vercel.</small></label>
<h2>Votre compte super-admin</h2><label>Votre email<input name="email" type="email" required autocomplete="username"></label>
<label>Mot de passe<input name="password" type="password" required minlength="12" autocomplete="new-password"><small>12 caractères minimum, avec lettres et chiffres.</small></label>
<h2>Votre première boutique (facultatif)</h2><label>Nom de la boutique<input name="shop_name" placeholder="FIFI QUALITY"></label>
<label>Adresse courte<input name="slug" placeholder="fifi" autocapitalize="none"><small>Lettres, chiffres et tirets. Votre boutique sera à l'adresse /adresse-courte (ex. ben-boutiques.vercel.app/fifi).</small></label>
<label>Numéro WhatsApp des commandes<input name="whatsapp" type="tel" placeholder="22670123456"></label>
<label>Mot de passe de la boutique<input name="shop_password" type="password" autocomplete="new-password"><small>8 caractères minimum. Identifiant de connexion de la boutique : admin.</small></label>
<p id="err" role="alert"></p><button type="submit">Terminer la configuration</button></form><div id="ok" hidden></div>`,
`document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();var d={};new FormData(this).forEach(function(v,k){d[k]=v});document.getElementById('err').textContent='';
fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){if(!x.ok){document.getElementById('err').textContent=x.j.error||'Erreur';return}
document.getElementById('f').hidden=true;var o=document.getElementById('ok');o.hidden=false;o.innerHTML='<h1>Terminé</h1><p>Compte de gestion : <a href="/super/">/super/</a> (votre email et votre mot de passe).</p>'+(x.j.slug?'<p>Boutique : <a href="/">page d\\'accueil</a> et son espace de gestion <a href="/admin/">/admin/</a> (identifiant : admin).</p>':'<p>Créez votre première boutique depuis <a href="/super/">/super/</a>, bouton « Nouvelle boutique ».</p>')}).catch(function(){document.getElementById('err').textContent='Connexion impossible'})});`);
}
