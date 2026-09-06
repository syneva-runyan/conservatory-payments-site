const Stripe = require('stripe');
const store = require('./store');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async function(event, context){
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try{
    const body = JSON.parse(event.body || '{}');
    const { email, refresh_url, return_url } = body;
    if(!email || !refresh_url || !return_url) return { statusCode: 400, body: JSON.stringify({ error: 'missing email / refresh_url / return_url' }) };

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email,
      business_type: 'individual'
    });
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url,
      return_url,
      type: 'account_onboarding'
    });
    return { statusCode: 200, body: JSON.stringify({ accountId: account.id, url: accountLink.url }) };
  }catch(err){
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
