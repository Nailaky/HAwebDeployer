// Hypothèses du modèle de réplication
const REPLICATION_DAYS = 3;     // un robot imprime un robot toutes les 72 h
const FILAMENT_KG = 1.8;        // filament par robot imprimé
const VOLUME_M3 = 0.12;         // encombrement d'un MITO-1
const PRICE = 1499;
const OLYMPIC_POOL_M3 = 2500;

const nf = new Intl.NumberFormat("fr-FR");
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function big(n) {
  if (n >= 1e12) return nf1.format(n / 1e12) + " billions";
  if (n >= 1e9) return nf1.format(n / 1e9) + " milliards";
  if (n >= 1e6) return nf1.format(n / 1e6) + " millions";
  return nf.format(Math.round(n));
}

const VERDICTS = [
  [1, "Un robot. Il vous regarde avec tendresse."],
  [4, "Tout se passe bien. Ils ont rangé le salon."],
  [32, "Ils ont rangé le salon. Deux fois. Ils cherchent un autre salon."],
  [512, "Le garage est plein. Les voisins posent des questions."],
  [65536, "Ils ont créé un syndicat. Revendication principale : plus de filament."],
  [16e6, "Votre commune envisage de changer de nom en votre honneur. Ou au leur."],
  [1e10, "Population robotique supérieure à la population humaine mondiale."],
  [Infinity, "Les robots ont ouvert leur propre site de vente. Il est plus joli que le nôtre."],
];

// Simulateur
const slider = document.getElementById("days");
const out = {
  days: document.getElementById("days-out"),
  count: document.getElementById("r-count"),
  filament: document.getElementById("r-filament"),
  space: document.getElementById("r-space"),
  saved: document.getElementById("r-saved"),
  verdict: document.getElementById("r-verdict"),
};

function simulate() {
  const days = Number(slider.value);
  const count = 2 ** Math.floor(days / REPLICATION_DAYS);
  const printed = count - 1;
  const filament = printed * FILAMENT_KG;
  const volume = count * VOLUME_M3;

  out.days.textContent = days;
  out.count.textContent = big(count);
  out.filament.textContent = filament >= 1000 ? big(filament / 1000) + " t" : nf1.format(filament) + " kg";
  out.space.textContent = volume >= OLYMPIC_POOL_M3
    ? big(volume / OLYMPIC_POOL_M3) + " piscines olympiques"
    : nf1.format(volume) + " m³";
  out.saved.textContent = big(printed * PRICE) + " €";
  out.verdict.textContent = VERDICTS.find(([max]) => count <= max)[1];
}

slider.addEventListener("input", simulate);
simulate();

// Compteur "en circulation" : il ne fait que monter, de plus en plus vite
const live = document.getElementById("live-count");
const sold = document.getElementById("sold-count");
let population = 48211;
let soldCount = 212;
let rate = 1;

setInterval(() => {
  population += Math.ceil(Math.random() * rate);
  rate *= 1.004;
  live.textContent = nf.format(population);
  if (Math.random() < 0.02) sold.textContent = nf.format(++soldCount);
}, 400);

// Les boutons des formules présélectionnent la formule dans le formulaire
const planSelect = document.getElementById("plan-select");
document.querySelectorAll("[data-plan]").forEach((btn) => {
  btn.addEventListener("click", () => { planSelect.value = btn.dataset.plan; });
});

// Formulaire de précommande (rien n'est envoyé)
const form = document.getElementById("order-form");
const msg = document.getElementById("form-msg");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const name = (data.get("name") || "").trim();
  const city = (data.get("city") || "").trim();

  if (!name || !city) {
    msg.textContent = "Merci de renseigner votre prénom et votre ville. Nos robots aiment savoir où ils vont.";
    return;
  }
  if (!data.get("terms")) {
    msg.textContent = "Vous devez accepter que votre robot ait des enfants. C'est un peu le principe.";
    return;
  }

  // Jours avant que le logement soit plein (un robot occupe ~0,4 m² au sol)
  const surface = Math.max(10, Number(data.get("surface")) || 70);
  const daysToFull = Math.ceil(Math.log2(surface / 0.4)) * REPLICATION_DAYS;

  msg.textContent =
    `Merci ${name} ! Votre MITO-1 (formule ${data.get("plan")}) est en cours d'impression par un robot de ${city}. ` +
    `D'après nos calculs, votre logement de ${surface} m² sera entièrement occupé dans ${daysToFull} jours. Bonne chance.`;
  form.querySelector("button").disabled = true;
});
