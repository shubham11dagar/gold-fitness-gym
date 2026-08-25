export async function onRequestPost(context) {
  try {
    const { env } = context;

     const keyId = env.RAZORPAY_KEY_ID;
    const keySecret = env.RAZORPAY_KEY_SECRET;
    const planId = env.RAZORPAY_PLAN_ID;

    // Securely encode credentials for Razorpay API Basic Auth
    const credentials = btoa(`${keyId}:${keySecret}`);

    // Request Razorpay to generate a subscription session
    const razorpayResponse = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan_id: planId,
        total_count: 12, // Number of billing cycles (e.g., 12 months)
        customer_notify: 1,
        quantity: 1
      })
    });

    const subscriptionData = await razorpayResponse.json();

    if (!razorpayResponse.ok) {
      return new Response(JSON.stringify({ error: subscriptionData }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(subscriptionData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
