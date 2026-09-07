require('dotenv').config();

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const Stripe = require('stripe');

const requiredEnvironment = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_CONNECTED_ACCOUNT_ID', 'STRIPE_WEBHOOK_SECRET'];
const missingEnvironment = requiredEnvironment.filter(name => !process.env[name]);
if (missingEnvironment.length) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const dataFile = path.join(__dirname, 'data', 'bookings.json');
const port = Number(process.env.PORT || process.env.API_PORT || 8888);
const publicDir = path.join(__dirname, 'dist');

async function readBookings() {
  try { return JSON.parse(await fs.readFile(dataFile, 'utf8') || '[]'); }
  catch { await fs.writeFile(dataFile, '[]', 'utf8'); return []; }
}
async function writeBookings(records) { await fs.writeFile(dataFile, JSON.stringify(records, null, 2), 'utf8'); }
async function readBody(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); }
function sendJson(response, statusCode, body) { response.writeHead(statusCode, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }
const contentTypes = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
async function serveStatic(request, response) {
  const requestedPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relativePath = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.resolve(publicDir, `.${relativePath}`);
  if (!filePath.startsWith(path.resolve(publicDir))) return sendJson(response, 403, { error: 'Forbidden' });
  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    try {
      const body = await fs.readFile(path.join(publicDir, 'index.html'));
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(body);
    } catch { sendJson(response, 404, { error: 'Not found' }); }
  }
}
async function stripeV2Request(endpoint, body) {
  const result = await fetch(`https://api.stripe.com/v2/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      'Stripe-Version': '2026-08-26.dahlia'
    },
    body: JSON.stringify(body)
  });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error?.message || `Stripe API error (${result.status})`);
  return data;
}

async function createCheckout(request, response) {
  try {
    const { booking, amount, currency = 'usd' } = JSON.parse((await readBody(request)).toString() || '{}');
    const connectedAccountId = process.env.STRIPE_CONNECTED_ACCOUNT_ID;
    if (!booking || !amount || !connectedAccountId) return sendJson(response, 400, { error: 'missing fields' });
    const records = await readBookings();
    const id = `b_${Date.now()}`;
    const newBooking = { id, customer_name: booking.customer_name, customer_email: booking.customer_email, event_date: booking.event_date, nights: booking.nights, payType: booking.payType, amount, currency, created_at: new Date().toISOString(), payment_status: 'pending' };
    records.push(newBooking); await writeBookings(records);
    const platformUrl = process.env.PLATFORM_URL || 'http://localhost:5173';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', ui_mode: 'embedded_page',
      line_items: [{ price_data: { currency, product_data: { name: `Blackberry Ridget Room Reservation - ${newBooking.nights} night${newBooking.nights === '1' ? '' : 's'}` }, unit_amount: amount }, quantity: 1 }],
      payment_intent_data: { receipt_email: booking.customer_email, transfer_data: { destination: connectedAccountId } }, customer_email: booking.customer_email, metadata: { booking_id: id },
      return_url: `${platformUrl}/success?session_id={CHECKOUT_SESSION_ID}`
    });
    if (!session.client_secret) throw new Error('Stripe did not return an Embedded Checkout client secret.');
    sendJson(response, 200, { clientSecret: session.client_secret, bookingId: id });
  } catch (error) { console.error(error); sendJson(response, 500, { error: error.message }); }
}

async function createExpressAccount(request, response) {
  try {
    const { email, refresh_url, return_url } = JSON.parse((await readBody(request)).toString() || '{}');
    if (!email || !refresh_url || !return_url) return sendJson(response, 400, { error: 'missing email / refresh_url / return_url' });
    const account = await stripeV2Request('core/accounts', {
      contact_email: email,
      display_name: 'Kaitlin and Carter Wedding Rooms',
      dashboard: 'express',
      identity: { country: 'us', entity_type: 'individual' },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } }
      },
      defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
      include: ['identity', 'configuration.merchant', 'requirements']
    });
    const accountLink = await stripeV2Request('core/account_links', {
      account: account.id,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: { configurations: ['merchant', 'recipient'], refresh_url, return_url }
      }
    });
    sendJson(response, 200, { accountId: account.id, url: accountLink.url });
  } catch (error) { console.error(error); sendJson(response, 500, { error: error.message }); }
}

async function handleWebhook(request, response) {
  try {
    const event = stripe.webhooks.constructEvent(await readBody(request), request.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    const records = await readBookings(); const object = event.data.object; const bookingId = object.metadata?.booking_id; const booking = records.find(record => record.id === bookingId);
    if (booking && event.type === 'checkout.session.completed') { booking.payment_status = 'paid'; booking.stripe_session = object.id; booking.stripe_payment_intent = object.payment_intent; await writeBookings(records); }
    if (booking && event.type === 'charge.refunded') { booking.payment_status = 'refunded'; await writeBookings(records); }
    sendJson(response, 200, { received: true });
  } catch (error) { console.error('Webhook error:', error.message); response.writeHead(400, { 'Content-Type': 'text/plain' }); response.end(`Webhook Error: ${error.message}`); }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/api/config') return sendJson(response, 200, { publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
  if (request.method === 'GET' && request.url.startsWith('/api/payment-details')) {
    try {
      const sessionId = new URL(request.url, `http://${request.headers.host}`).searchParams.get('session_id');
      if (!sessionId) return sendJson(response, 400, { error: 'missing session_id' });
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return sendJson(response, 200, { paymentIntentId: session.payment_intent });
    } catch (error) { return sendJson(response, 500, { error: error.message }); }
  }
  if (request.method === 'POST' && request.url === '/api/create-checkout-session') return createCheckout(request, response);
  if (request.method === 'POST' && request.url === '/api/create-express-account') return createExpressAccount(request, response);
  if (request.method === 'POST' && request.url === '/api/webhook') return handleWebhook(request, response);
  if (request.method === 'GET') return serveStatic(request, response);
  sendJson(response, 404, { error: 'Not found' });
});
server.listen(port, '0.0.0.0', () => console.log(`Server listening on port ${port}`));