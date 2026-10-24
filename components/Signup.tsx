import { esc } from '@/lib/util';
import { signupMode, placesLeft, trialDays } from '@/lib/signup';

const VER = '20261022';
export async function signupPage(host: string): Promise<Response> {
  const name = process.env.PLATFORM_NAME || 'Ben-Dev Boutiques', root = process.env.ROOT_DOMAIN || host, mode = signupMode();
  let left = 0; try { left = await placesLeft(); } catch { /* base indisponible */ }
  const trial = trialDays();
  const closed = mode === 'off' || left <= 0;
  const form = closed
    ? `<p class="lead">${mode === 'off' ? 'Les inscriptions sont fermées pour le moment.' : 'Toutes les places sont prises pour le moment.'}</p><p><a class="btn line" href="/">Retour à l’accueil</a></p>`
    : `<p class="lead">${left} place${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}. ${trial ? `${trial} jours d’essai, sans carte bancaire.` : ''} ${mode === 'review' ? 'Nous validons votre demande sous 24 h.' : 'Votre boutique est créée tout de suite.'}</p>
<form id="f" novalidate>
 <label>Nom de votre boutique<input name="name" required maxlength="60" autocomplete="organization" placeholder="Ex. Mode Awa"></label>
 <label>Adresse de la boutique<span class="slug"><input name="slug" required maxlength="30" autocapitalize="none" spellcheck="false" placeholder="mode-awa"><i>.${esc(root)}</i></span><small id="sl" aria-live="polite"></small></label>
 <label>Numéro WhatsApp des commandes<input name="whatsapp" required type="tel" inputmode="tel" autocomplete="tel" placeholder="22670123456"><small>Format international, sans le +. Vos clients vous écriront ici.</small></label>
 <label><span>Email <em>(facultatif)</em></span><input name="email" type="email" autocomplete="email"></label>
 <label>Mot de passe<input name="password" required type="password" minlength="8" autocomplete="new-password"><small>8 caractères minimum, avec des lettres et des chiffres. Identifiant de connexion : admin.</small></label>
 <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
 <p id="err" role="alert"></p>
 <button class="btn main" id="go" type="submit">Créer ma boutique</button>
</form>
<div id="ok" hidden></div>`;
  const js = `(function(){var f=document.getElementById('f');if(!f)return;var $=function(i){return document.getElementById(i)},sl=f.slug,nm=f.name,touched=false,t;
function slugify(s){return s.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30)}
function check(){clearTimeout(t);var v=slugify(sl.value);if(v.length<3){$('sl').textContent='';return}t=setTimeout(function(){fetch('/api/signup?slug='+encodeURIComponent(v)).then(function(r){return r.json()}).then(function(d){$('sl').textContent=d.ok?'✓ '+d.slug+' est disponible':(d.reason||'');$('sl').className=d.ok?'good':'bad'}).catch(function(){})},300)}
nm.addEventListener('input',function(){if(!touched){sl.value=slugify(nm.value);check()}});sl.addEventListener('input',function(){touched=true;check()});
f.addEventListener('submit',function(e){e.preventDefault();var b=$('go');$('err').textContent='';b.disabled=true;b.textContent='Création…';
var d={};new FormData(f).forEach(function(v,k){d[k]=v});
fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){
if(!x.ok){$('err').textContent=x.j.error||'Une erreur est survenue';b.disabled=false;b.textContent='Créer ma boutique';return}
f.hidden=true;var o=$('ok');o.hidden=false;
if(x.j.mode==='auto'&&x.j.url){o.innerHTML='<h2>Votre boutique est prête.</h2><p class="lead">Connectez-vous avec l’identifiant <b>admin</b> et votre mot de passe.</p><p><a class="btn main" href="'+x.j.url+'/admin/">Ouvrir mon espace</a> <a class="btn line" href="'+x.j.url+'">Voir ma boutique</a></p>'}
else{o.innerHTML='<h2>Demande reçue.</h2><p class="lead">Nous vous écrivons sur WhatsApp dès que votre boutique est ouverte, en général sous 24 h.</p><p><a class="btn line" href="/">Retour à l’accueil</a></p>'}
}).catch(function(){$('err').textContent='Connexion impossible, réessayez.';b.disabled=false;b.textContent='Créer ma boutique'})})})();`;
  const html = `<!DOCTYPE html>\n<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Créer ma boutique – ${esc(name)}</title><meta name="description" content="Ouvrez votre boutique en ligne en quelques minutes : catalogue, panier et commandes sur WhatsApp."><link rel="canonical" href="https://${esc(host)}/inscription"><meta name="theme-color" content="#0D3B2C">
<link rel="preload" href="/fonts/bricolage.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/landing/landing.css?v=20261020"><link rel="stylesheet" href="/landing/signup.css?v=${VER}"></head>
<body data-k="l"><main class="su"><a class="logo" href="/"><i></i>${esc(name)}</a><h1>Créez votre boutique</h1>${form}</main><script>${js}</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
