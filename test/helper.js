const fs = require('fs');
const _ = require('lodash');
const session = require('supertest-session');
const app = require('../app.js');
const { getId, newId } = require('../lib/common');
const { runIndexing, fixProductDates } = require('../lib/indexing');

// Get test data to compare in tests
const rawTestData = fs.readFileSync('./bin/testdata.json', 'utf-8');
const jsonData = JSON.parse(rawTestData);

// Setup some global DB objects for comparison
const g = {
    db: {},
    config: {},
    products: {},
    customers: {},
    users: {},
    request: null,
    jsonData
};

const setup = (db) => {
    return Promise.all([
        db.cart.deleteMany({}, {}),
        db.users.deleteMany({}, {}),
        db.customers.deleteMany({}, {}),
        db.products.deleteMany({}, {}),
        db.orders.deleteMany({}, {})
    ])
    .then(() => {
        return Promise.all([
            db.users.insertMany(jsonData.users),
            db.customers.insertMany(jsonData.customers),
            db.products.insertMany(fixProductDates(jsonData.products))
        ]);
    });
};

const runBefore = async () => {
    // Create a session
    g.request = session(app);
    await new Promise(resolve => {
        app.on('appStarted', async () => {
            // Set some stuff now we have the app started
            g.config = app.config;
            g.db = app.db;

            await setup(g.db);

            // Get some data from DB to use in compares
            g.products = await g.db.products.find({}).toArray();
            g.customers = await g.db.customers.find({}).toArray();

            // Insert orders using product ID's
            _(jsonData.orders).each(async (order) => {
                order.orderProducts.push({
                    productId: g.products[0]._id,
                    title: g.products[0].productTitle,
                    quantity: 1,
                    totalItemPrice: g.products[0].productPrice,
                    options: {
                        size: '7.5'
                    },
                    productImage: g.products[0].productImage,
                    productComment: null
                });
                order.orderDate = new Date();
                await g.db.orders.insertOne(order);
            });

            // Add API keys for users
            _(jsonData.users).each(async (user) => {
                await g.db.users.updateOne({
                    _id: getId(user._id)
                }, {
                    $set: {
                        apiKey: newId()
                    }
                });
            });

            // Get the updated users
            g.users = await g.db.users.find({}).toArray();

            // Index everything
            await runIndexing(app);

            resolve();
        });
    });
};

module.exports = {
    runBefore,
    setup,
    g
};
