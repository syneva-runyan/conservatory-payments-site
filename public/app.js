// Simple client script to create a checkout session via the local API

const form = document.getElementById('booking-form');
const totalEl = document.getElementById('total-amount');
const checkoutContainer = document.getElementById('embedded-checkout');
const confirmation = document.getElementById('confirmation');
const confirmationReference = document.getElementById('confirmation-reference');
const returnToPayment = document.getElementById('return-to-payment');
const stayNoteEl = document.getElementById('stay-note');
const stayDatesEl = document.getElementById('stay-dates');
const dogEl = document.querySelector('.dog-mark');

let barkContext;
let lastBarkAt = 0;
let barkBufferPromise;

function loadBark(){
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if(!AudioContextClass) return Promise.resolve(null);
  barkContext ||= new AudioContextClass();
  barkBufferPromise ||= fetch('/dogBark.mp3')
    .then(response => response.arrayBuffer())
    .then(buffer => barkContext.decodeAudioData(buffer));
  return barkBufferPromise;
}

function firstBarkWindow(buffer){
  const samples = buffer.getChannelData(0);
  const windowSize = Math.max(1, Math.floor(buffer.sampleRate * .01));
  const levels = [];
  for(let offset = 0; offset < samples.length; offset += windowSize) {
    let energy = 0;
    const end = Math.min(offset + windowSize, samples.length);
    for(let index = offset; index < end; index += 1) energy += samples[index] ** 2;
    levels.push(Math.sqrt(energy / (end - offset)));
  }
  const peak = Math.max(...levels);
  const threshold = Math.max(peak * .1, .008);
  const startWindow = levels.findIndex(level => level > threshold);
  if(startWindow < 0) return { start: 0, duration: Math.min(buffer.duration, .8) };
  let endWindow = startWindow;
  let quietWindows = 0;
  for(let index = startWindow; index < levels.length; index += 1) {
    if(levels[index] <= threshold) quietWindows += 1;
    else quietWindows = 0;
    if(quietWindows >= 12) {
      endWindow = index - quietWindows + 1;
      break;
    }
    endWindow = index;
  }
  const start = Math.max(0, (startWindow - 2) * .01);
  const end = Math.min(buffer.duration, (endWindow + 3) * .01);
  return { start, duration: Math.max(.08, end - start) };
}

function playBark(force = false){
  const now = performance.now();
  if(!force && now - lastBarkAt < 450) return;
  lastBarkAt = now;
  loadBark().then(buffer => {
    if(!buffer) return;
    const play = () => {
      const clip = firstBarkWindow(buffer);
      const source = barkContext.createBufferSource();
      const gain = barkContext.createGain();
      source.buffer = buffer;
      source.playbackRate.value = .73;
      gain.gain.value = .8;
      source.connect(gain);
      gain.connect(barkContext.destination);
      source.start(0, clip.start, clip.duration);
    };
    if(barkContext.state === 'suspended') barkContext.resume().then(play);
    else play();
  }).catch(() => {});
}

dogEl.addEventListener('click', () => playBark(true));
dogEl.addEventListener('keydown', (event) => {
  if(event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    playBark(true);
  }
});

function showConfirmation(){
  form.hidden = true;
  checkoutContainer.hidden = true;
  confirmation.hidden = false;
  requestAnimationFrame(() => confirmation.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

if(window.location.pathname === '/success' && new URLSearchParams(window.location.search).has('session_id')){
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const bookingId = sessionStorage.getItem('bookingId');
  showConfirmation();
  confirmationReference.textContent = 'Loading payment ID...';
  fetch(`/api/payment-details?session_id=${encodeURIComponent(sessionId)}`)
    .then(response => response.json())
    .then(details => { confirmationReference.textContent = details.paymentIntentId || bookingId || sessionId.slice(-12).toUpperCase(); })
    .catch(() => { confirmationReference.textContent = bookingId || sessionId.slice(-12).toUpperCase(); });
}

returnToPayment.addEventListener('click', () => {
  window.history.replaceState({}, document.title, window.location.pathname === '/success' ? '/' : window.location.pathname);
  sessionStorage.removeItem('bookingId');
  confirmation.hidden = true;
  form.hidden = false;
  window.scrollTo({ top: document.querySelector('.booking-card').offsetTop - 24, behavior: 'smooth' });
});

function centsForSelection(nights){
  return Number(nights) * 25000;
}

function updateTotal(){
  const nights = form.nights.value;
  const cents = centsForSelection(nights);
  totalEl.textContent = `$${(cents/100).toFixed(2)}`;
  updateStayDates(nights);
}

function updateStayDates(nights){
  const weddingDate = new Date(`${form.date.value}T12:00:00`);
  const firstNight = new Date(weddingDate);
  if(Number(nights) > 1) firstNight.setDate(firstNight.getDate() - 1);
  const lastNight = new Date(firstNight);
  lastNight.setDate(lastNight.getDate() + Number(nights) - 1);
  const dateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  stayNoteEl.textContent = Number(nights) === 1 ? 'Just the wedding night' : 'The full wedding weekend';
  stayDatesEl.replaceChildren(document.createTextNode(dateFormat.format(firstNight)));
  if(Number(nights) > 1) {
    stayDatesEl.append(document.createElement('br'), document.createTextNode(dateFormat.format(lastNight)));
  }
}

form.nights.addEventListener('change', updateTotal);
updateTotal();

form.addEventListener('submit', async (e) =>{
  e.preventDefault();
  try {
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    const cents = centsForSelection(payload.nights);
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking: { customer_name: payload.name, customer_email: payload.email, event_date: payload.date, nights: payload.nights },
        amount: cents,
        currency: 'usd'
      })
    });
    const body = await res.json();
    if(!res.ok || !body.clientSecret) throw new Error(body.error || 'Stripe did not return a checkout session.');
    sessionStorage.setItem('bookingId', body.bookingId);
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    if(!config.publishableKey) throw new Error('Stripe publishable key is not configured.');
    const stripe = Stripe(config.publishableKey);
    const checkout = await stripe.initEmbeddedCheckout({
      clientSecret: body.clientSecret,
      onComplete: showConfirmation
    });
    form.hidden = true;
    checkoutContainer.hidden = false;
    checkout.mount(checkoutContainer);
  } catch (error) {
    alert('Error creating checkout session: ' + error.message);
  }
});
