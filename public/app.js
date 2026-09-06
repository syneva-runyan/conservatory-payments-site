// Simple client script to create a checkout session via Netlify Function

const form = document.getElementById('booking-form');
const totalEl = document.getElementById('total-amount');
const connectedInput = document.getElementById('connectedAccountId');

function centsForSelection(pkg, payType){
  if(pkg === 'ceremony'){
    return payType === 'deposit' ? 12500 : 50000; // $125 deposit or $500 full
  }
  if(pkg === 'full'){
    return payType === 'deposit' ? 62500 : 250000; // $625 deposit or $2500 full
  }
  return 0;
}

function updateTotal(){
  const pkg = form.package.value;
  const payType = form.payType.value;
  const cents = centsForSelection(pkg, payType);
  totalEl.textContent = `$${(cents/100).toFixed(2)}`;
}

form.package.addEventListener('change', updateTotal);
form.payType.addEventListener('change', updateTotal);
updateTotal();

form.addEventListener('submit', async (e) =>{
  e.preventDefault();
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  const cents = centsForSelection(payload.package, payload.payType);
  if(!payload.connectedAccountId){
    alert('Enter connected account id (acct_...) for demo');
    return;
  }
  // Create a booking on the demo store and a Checkout session
  const res = await fetch('/.netlify/functions/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      booking: {
        customer_name: payload.name,
        customer_email: payload.email,
        event_date: payload.date,
        package: payload.package,
        payType: payload.payType
      },
      amount: cents,
      currency: 'usd',
      connectedAccountId: payload.connectedAccountId
    })
  });
  const body = await res.json();
  if(body.url){
    // redirect to Stripe Checkout
    window.location = body.url;
  } else {
    alert('Error creating checkout session: ' + (body.error || 'unknown'));
  }
});
