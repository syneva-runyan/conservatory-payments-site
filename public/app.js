// Simple client script to create a checkout session via the local API

const form = document.getElementById('booking-form');
const totalEl = document.getElementById('total-amount');
const checkoutContainer = document.getElementById('embedded-checkout');
const confirmation = document.getElementById('confirmation');
const confirmationReference = document.getElementById('confirmation-reference');
const returnToPayment = document.getElementById('return-to-payment');
const stayDatesEl = document.getElementById('stay-dates');
const stayNoteEl = document.getElementById('stay-note');

if(window.location.pathname === '/success' && new URLSearchParams(window.location.search).has('session_id')){
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const bookingId = sessionStorage.getItem('bookingId');
  form.hidden = true;
  confirmation.hidden = false;
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
  stayDatesEl.textContent = `${dateFormat.format(firstNight)}${Number(nights) > 1 ? ` - ${dateFormat.format(lastNight)}` : ''}`;
  stayNoteEl.textContent = Number(nights) === 1 ? 'Just the wedding night' : 'The full wedding weekend';
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
    const checkout = await stripe.initEmbeddedCheckout({ clientSecret: body.clientSecret });
    form.hidden = true;
    checkoutContainer.hidden = false;
    checkout.mount(checkoutContainer);
  } catch (error) {
    alert('Error creating checkout session: ' + error.message);
  }
});
