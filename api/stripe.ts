import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2024-06-20' as any,
});

const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const error = (message: string, status = 400) => json({ error: message }, status);

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const op = url.searchParams.get('op') || '';

        try {
            // CREATE CONNECT ACCOUNT
            if (op === 'create-account' && request.method === 'POST') {
                const body = await request.json();
                const { email, country = 'US' } = body;

                if (!email) {
                    return error('Email is required', 400);
                }

                const account = await stripe.accounts.create({
                    type: 'express',
                    country,
                    email,
                    capabilities: {
                        card_payments: { requested: true },
                        transfers: { requested: true },
                    },
                });

                return json({
                    accountId: account.id,
                    chargesEnabled: account.charges_enabled,
                    payoutsEnabled: account.payouts_enabled,
                    detailsSubmitted: account.details_submitted,
                });
            }

            // CREATE ACCOUNT LINK (for onboarding)
            if (op === 'create-account-link' && request.method === 'POST') {
                const body = await request.json();
                const { accountId, returnUrl, refreshUrl } = body;

                if (!accountId) {
                    return error('accountId is required', 400);
                }

                const accountLink = await stripe.accountLinks.create({
                    account: accountId,
                    refresh_url: refreshUrl || `${url.origin}/stripe/refresh`,
                    return_url: returnUrl || `${url.origin}/stripe/return`,
                    type: 'account_onboarding',
                });

                return json({ url: accountLink.url });
            }

            // GET ACCOUNT STATUS
            if (op === 'account-status' && request.method === 'GET') {
                const accountId = url.searchParams.get('accountId');

                if (!accountId) {
                    return error('accountId is required', 400);
                }

                const account = await stripe.accounts.retrieve(accountId);

                return json({
                    id: account.id,
                    chargesEnabled: account.charges_enabled,
                    payoutsEnabled: account.payouts_enabled,
                    detailsSubmitted: account.details_submitted,
                    requirements: account.requirements,
                });
            }

            // CREATE PRODUCT
            if (op === 'create-product' && request.method === 'POST') {
                const body = await request.json();
                const { accountId, name, description, price, currency = 'usd', images } = body;

                if (!accountId || !name || !price) {
                    return error('accountId, name, and price are required', 400);
                }

                // Create product on the connected account
                const productParams: Stripe.ProductCreateParams = {
                    name,
                    description: description || undefined,
                };

                // Add images if provided (must be publicly accessible URLs)
                if (images && Array.isArray(images) && images.length > 0) {
                    productParams.images = images;
                }

                const product = await stripe.products.create(
                    productParams,
                    { stripeAccount: accountId }
                );

                // Create price for the product
                const priceObj = await stripe.prices.create(
                    {
                        product: product.id,
                        unit_amount: Math.round(price * 100), // Convert to cents
                        currency,
                    },
                    { stripeAccount: accountId }
                );

                return json({
                    id: product.id,
                    name: product.name,
                    description: product.description,
                    priceId: priceObj.id,
                    unitAmount: priceObj.unit_amount,
                    currency: priceObj.currency,
                    images: product.images,
                });
            }

            // LIST PRODUCTS
            if (op === 'list-products' && request.method === 'GET') {
                const accountId = url.searchParams.get('accountId');

                if (!accountId) {
                    return error('accountId is required', 400);
                }

                const prices = await stripe.prices.list(
                    {
                        active: true,
                        expand: ['data.product'],
                        limit: 100,
                    },
                    { stripeAccount: accountId }
                );

                const products = prices.data.map((price) => {
                    const product = price.product as Stripe.Product;
                    return {
                        id: product.id,
                        name: product.name,
                        description: product.description,
                        priceId: price.id,
                        unitAmount: price.unit_amount,
                        currency: price.currency,
                        createdAt: product.created,
                        images: product.images,
                    };
                });

                return json({ products });
            }

            // CREATE PAYMENT LINK
            if (op === 'create-payment-link' && request.method === 'POST') {
                const body = await request.json();
                const {
                    accountId,
                    priceId,
                    quantity = 1,
                    brandingSettings,
                    collectBillingAddress = false,
                    collectShippingAddress = false,
                    collectPhone = false,
                    automaticTax = false,
                    allowedCountries,
                    afterCompletionMessage,
                    afterCompletionRedirectUrl,
                    customFields,
                    quantityOptions
                } = body;

                if (!accountId || !priceId) {
                    return error('accountId and priceId are required', 400);
                }

                const paymentLinkParams: Stripe.PaymentLinkCreateParams = {
                    line_items: [
                        {
                            price: priceId,
                            quantity,
                            ...(quantityOptions?.enabled && {
                                adjustable_quantity: {
                                    enabled: true,
                                    minimum: quantityOptions.minimum,
                                    maximum: quantityOptions.maximum,
                                },
                            }),
                        },
                    ],
                };

                // Add custom fields
                if (customFields && Array.isArray(customFields) && customFields.length > 0) {
                    paymentLinkParams.custom_fields = customFields.map((field: any) => ({
                        key: field.key,
                        label: {
                            type: 'custom',
                            custom: field.label,
                        },
                        type: field.type,
                    }));
                }

                // Billing address collection
                if (collectBillingAddress) {
                    paymentLinkParams.billing_address_collection = 'required';
                }

                // Shipping address collection
                if (collectShippingAddress && allowedCountries && allowedCountries.length > 0) {
                    paymentLinkParams.shipping_address_collection = {
                        allowed_countries: allowedCountries,
                    };
                }

                // Phone number collection
                if (collectPhone) {
                    paymentLinkParams.phone_number_collection = {
                        enabled: true,
                    };
                }

                // Automatic tax calculation
                if (automaticTax) {
                    paymentLinkParams.automatic_tax = {
                        enabled: true,
                    };
                }

                // After completion behavior
                if (afterCompletionMessage) {
                    paymentLinkParams.after_completion = {
                        type: 'hosted_confirmation',
                        hosted_confirmation: {
                            custom_message: afterCompletionMessage,
                        },
                    };
                } else if (afterCompletionRedirectUrl) {
                    paymentLinkParams.after_completion = {
                        type: 'redirect',
                        redirect: {
                            url: afterCompletionRedirectUrl,
                        },
                    };
                }

                const paymentLink = await stripe.paymentLinks.create(
                    paymentLinkParams,
                    { stripeAccount: accountId }
                );

                return json({
                    id: paymentLink.id,
                    url: paymentLink.url,
                    active: paymentLink.active,
                });
            }

            // CREATE CHECKOUT SESSION
            if (op === 'create-checkout-session' && request.method === 'POST') {
                const body = await request.json();
                const {
                    accountId,
                    priceId,
                    quantity = 1,
                    successUrl,
                    cancelUrl,
                    // Branding settings
                    brandingSettings
                } = body;

                if (!accountId || !priceId || !successUrl) {
                    return error('accountId, priceId, and successUrl are required', 400);
                }

                // Build session options
                const sessionOptions: any = {
                    mode: 'payment',
                    line_items: [
                        {
                            price: priceId,
                            quantity,
                        },
                    ],
                    success_url: successUrl,
                    cancel_url: cancelUrl || successUrl,
                };

                // Add branding settings if provided
                if (brandingSettings) {
                    sessionOptions.branding_settings = {
                        ...(brandingSettings.displayName && { display_name: brandingSettings.displayName }),
                        ...(brandingSettings.fontFamily && { font_family: brandingSettings.fontFamily }),
                        ...(brandingSettings.borderStyle && { border_style: brandingSettings.borderStyle }),
                        ...(brandingSettings.backgroundColor && { background_color: brandingSettings.backgroundColor }),
                        ...(brandingSettings.buttonColor && { button_color: brandingSettings.buttonColor }),
                    };
                }

                const session = await stripe.checkout.sessions.create(
                    sessionOptions,
                    { stripeAccount: accountId }
                );

                return json({
                    id: session.id,
                    url: session.url,
                    status: session.status,
                });
            }

            // DELETE PRODUCT
            if (op === 'delete-product' && request.method === 'DELETE') {
                const body = await request.json();
                const { accountId, productId, priceId } = body;

                if (!accountId || !productId) {
                    return error('accountId and productId are required', 400);
                }

                // First archive the price if provided (prices can't be deleted, only archived)
                if (priceId) {
                    await stripe.prices.update(
                        priceId,
                        { active: false },
                        { stripeAccount: accountId }
                    );
                }

                // Then delete the product
                const deleted = await stripe.products.del(productId, {
                    stripeAccount: accountId,
                });

                return json({
                    id: deleted.id,
                    deleted: deleted.deleted,
                });
            }

            // LIST ORDERS (Checkout Sessions)
            if (op === 'list-orders' && request.method === 'GET') {
                const accountId = url.searchParams.get('accountId');
                const priceId = url.searchParams.get('priceId');

                if (!accountId) {
                    return error('accountId is required', 400);
                }

                // List checkout sessions
                // We'll filter by priceId manually if needed, or by created date
                const sessions = await stripe.checkout.sessions.list(
                    {
                        limit: 100,
                        expand: ['data.line_items', 'data.customer_details'],
                    },
                    { stripeAccount: accountId }
                );

                // Filter for successful payments and specific price if provided
                const orders = sessions.data
                    .filter((session: any) =>
                        session.payment_status === 'paid' &&
                        session.status === 'complete' &&
                        (!priceId || session.line_items?.data.some((item: any) => item.price?.id === priceId))
                    )
                    .map((session: any) => ({
                        id: session.id,
                        customerEmail: session.customer_details?.email || session.customer_email,
                        customerName: session.customer_details?.name,
                        amount: session.amount_total,
                        currency: session.currency,
                        status: session.status,
                        paymentStatus: session.payment_status,
                        createdAt: session.created,
                        lineItems: session.line_items?.data.map((item: any) => ({
                            description: item.description,
                            quantity: item.quantity,
                            amount: item.amount_total,
                            priceId: item.price?.id
                        }))
                    }));

                return json({ orders });
            }

            return error('Invalid operation', 400);
        } catch (e: any) {
            console.error('[Stripe API Error]', e);
            return error(e?.message || 'Internal server error', 500);
        }
    },
};
