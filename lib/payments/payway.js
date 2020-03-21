const express = require('express');
const common = require('../common');
const { indexOrders } = require('../indexing');
const numeral = require('numeral');
const got = require('got');
const randtoken = require('rand-token');
const router = express.Router();

// The homepage of the site
router.post('/checkout_action', async (req, res, next) => {
    const db = req.app.db;
    const config = req.app.config;
    const paymentConfig = common.getPaymentConfig();

    // Create the payload
    const payload = {
        singleUseTokenId: req.body.singleUseTokenId,
        customerNumber: randtoken.generate(20),
        transactionType: 'payment',
        principalAmount: numeral(req.session.totalCartAmount).format('0.00'),
        currency: 'aud',
        merchantId: paymentConfig.merchantId
    };

    // Check for single use token
    if(!req.body.singleUseTokenId || req.body.singleUseTokenId === ''){
        console.info('Either null or no single use token', req.body);
        req.session.messageType = 'danger';
        req.session.message = 'Your payment has failed. Please try again';
        req.session.paymentApproved = false;
        req.session.paymentDetails = '';
        res.redirect('/checkout/payment');
        return;
    }

    try{
        let txn = await got.post('https://api.payway.com.au/rest/v1/transactions', {
            username: paymentConfig.apiKey,
            form: payload,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            }
        });

        // Parse the response
        txn = JSON.parse(txn.body);

        // order status if approved
        let orderStatus = 'Paid';
        if(txn && txn.status === 'declined'){
            console.log('Declined response payload', txn);
            orderStatus = 'Declined';
        }

        const orderDoc = {
            orderPaymentId: txn.transactionId.toString(),
            orderPaymentGateway: 'PayWay',
            orderPaymentMessage: `${txn.responseCode} - ${txn.responseText}`,
            orderTotal: req.session.totalCartAmount,
            orderShipping: req.session.totalCartShipping,
            orderItemCount: req.session.totalCartItems,
            orderProductCount: req.session.totalCartProducts,
            orderCustomer: common.getId(req.session.customerId),
            orderEmail: req.session.customerEmail,
            orderCompany: req.session.customerCompany,
            orderFirstname: req.session.customerFirstname,
            orderLastname: req.session.customerLastname,
            orderAddr1: req.session.customerAddress1,
            orderAddr2: req.session.customerAddress2,
            orderCountry: req.session.customerCountry,
            orderState: req.session.customerState,
            orderPostcode: req.session.customerPostcode,
            orderPhoneNumber: req.session.customerPhone,
            orderComment: req.session.orderComment,
            orderStatus: orderStatus,
            orderDate: new Date(),
            orderProducts: req.session.cart,
            orderType: 'Single'
        };

        // insert order into DB
        try{
            const newDoc = await db.orders.insertOne(orderDoc);

            // get the new ID
            const newId = newDoc.insertedId;

            // add to lunr index
            indexOrders(req.app)
            .then(() => {
                // if approved, send email etc
                if(orderStatus === 'Paid'){
                    // set the results
                    req.session.messageType = 'success';
                    req.session.message = 'Your payment was successfully completed';
                    req.session.paymentEmailAddr = newDoc.ops[0].orderEmail;
                    req.session.paymentApproved = true;
                    req.session.paymentDetails = `<p><strong>Order ID: </strong>${newId}</p>
                    <p><strong>Transaction ID: </strong>${orderDoc.orderPaymentId}</p>`;

                    // set payment results for email
                    const paymentResults = {
                        message: req.session.message,
                        messageType: req.session.messageType,
                        paymentEmailAddr: req.session.paymentEmailAddr,
                        paymentApproved: true,
                        paymentDetails: req.session.paymentDetails
                    };

                    // clear the cart
                    if(req.session.cart){
                        common.emptyCart(req, res, 'function');
                    }

                    // send the email with the response
                    // TODO: Should fix this to properly handle result
                    common.sendEmail(req.session.paymentEmailAddr, `Your payment with ${config.cartTitle}`, common.getEmailTemplate(paymentResults));

                    // redirect to outcome
                    res.redirect('/payment/' + newId);
                }else{
                    // redirect to failure
                    req.session.messageType = 'danger';
                    req.session.message = 'Your payment has declined. Please try again';
                    req.session.paymentApproved = false;
                    req.session.paymentDetails = `<p><strong>Order ID: </strong>${newId}
                    </p><p><strong>Transaction ID: </strong> ${txn.transHash}</p>`;
                    res.redirect('/payment/' + newId);
                }
            });
        }catch(ex){
            console.log('Error sending payment to API', ex);
            res.status(400).json({ err: 'Your payment has declined. Please try again' });
        }
    }catch(ex){
        console.info('Exception processing payment', ex);
        req.session.messageType = 'danger';
        req.session.message = 'Your payment has declined. Please try again';
        req.session.paymentApproved = false;
        req.session.paymentDetails = '';
        res.redirect('/checkout/payment');
    }
});

module.exports = router;
