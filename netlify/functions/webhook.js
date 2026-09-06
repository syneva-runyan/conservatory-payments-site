const Stripe = require('stripe');
const store = require('./store');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event, context){
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  let eventObj;
  try{
    const buf = Buffer.from(event.body, 'utf8');
    eventObj = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(err){
    console.error('Webhook signature verification failed.', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try{
    switch(eventObj.type){
      case 'checkout.session.completed':{
        const session = eventObj.data.object;
        const bookingId = session.metadata?.booking_id;
        if(bookingId){
          const records = await store.read();
          const idx = records.findIndex(r => r.id === bookingId);
          if(idx >= 0){
            records[idx].payment_status = 'paid';
            records[idx].stripe_session = session.id;
            records[idx].stripe_payment_intent = session.payment_intent;
            await store.write(records);
            console.log('Marked booking paid', bookingId);
          }
        }
        break;
      }
      case 'charge.refunded':{
        const charge = eventObj.data.object;
        const mp = charge.metadata || {};
        const bookingId = mp.booking_id;
        if(bookingId){
          const records = await store.read();
          const idx = records.findIndex(r => r.id === bookingId);
          if(idx >= 0){
            records[idx].payment_status = 'refunded';
            await store.write(records);
          }
        }
        break;
      }
      default:
        console.log('Unhandled event', eventObj.type);
    }
  }catch(err){
    console.error('Error handling webhook', err);
    return { statusCode: 500, body: 'Server error' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}
