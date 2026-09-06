# Conservatory Payments Site

This repository is a starter static site + Netlify Functions example to accept payments via Stripe Connect (Express) and route funds to a connected account (your mother-in-law) while keeping the venue branding.

Goal
- Clone the repo, set environment variables, and run npm run dev to preview the site locally (Netlify dev), including serverless endpoints for onboarding, Checkout session creation, and webhooks.

Quick start
1. Clone
   git clone https://github.com/syneva-runyan/conservatory-payments-site.git
   cd conservatory-payments-site

2. Install
   npm install

3. Create a .env file from .env.example and fill in your Stripe test keys and PLATFORM_URL.

4. Start locally
   npm run dev

   Netlify Dev will start a local server at http://localhost:8888 by default and emulate Netlify Functions.

Environment variables (.env)
- STRIPE_SECRET_KEY - your Stripe secret key (test)
- STRIPE_PUBLISHABLE_KEY - your Stripe publishable key (test)
- STRIPE_WEBHOOK_SECRET - your webhook signing secret (test)
- PLATFORM_URL - example: http://localhost:8888

Notes
- This project uses a simple JSON file for demo persistence (data/bookings.json). For production, use a proper DB (Supabase/Postgres).
- For production deploys, use Netlify or Vercel and set environment variables in the dashboard.
- This is a demo starter — review security and legal/tax requirements before going live.
