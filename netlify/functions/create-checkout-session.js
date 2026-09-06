const Stripe = require('stripe');
const store = require('./store');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event, context){
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try{
    const body = JSON.parse(event.body || '{}');
    const { booking, amount, currency = 'usd', connectedAccountId } = body;
    if(!booking || !amount || !connectedAccountId) return { statusCode: 400, body: JSON.stringify({ error: 'missing fields' }) };

    // Create a local booking record
    const records = await store.read();
    const id = `b_${Date.now()}`;
    const newBooking = {
      id,
      customer_name: booking.customer_name,
      customer_email: booking.customer_email,
      event_date: booking.event_date,
      package: booking.package,
      payType: booking.payType,
      amount,
      currency,
      created_at: new Date().toISOString(),
      payment_status: 'pending'
    };
    records.push(newBooking);
    await store.write(records);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency,
          product_data: { name: `Booking ${id} - ${newBooking.package}` },
          unit_amount: amount
        },
        quantity: 1
      }],
      payment_intent_data: {
        transfer_data: { destination: connectedAccountId }
      },
      customer_email: booking.customer_email,
      metadata: { booking_id: id },
      success_url: `${process.env.PLATFORM_URL || 'http://localhost:8888'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.PLATFORM_URL || 'http://localhost:8888'}/cancel`
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url, bookingId: id }) };
  }catch(err){
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
