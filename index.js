const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 7007;

const app = express();

// --------Middle-Ware---------
app.use(cors());
app.use(express.json());

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized Access' });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        req.decoded = decoded;
        next();
    })
}

// -------------Database Connection--------------
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.vvll70g.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function dbConnect() {
    try {
        await client.connect();
        console.log('Database is Connected');

    } catch (error) {
        console.log(error.name, error.message);
    }
}
dbConnect();

// ------------Collections----------
const appointmentCollection = client.db('doctorsPortal').collection('appointmentOptions');
const bookingCollection = client.db('doctorsPortal').collection('bookings');
const usersCollection = client.db('doctorsPortal').collection('users');
const doctorsCollection = client.db('doctorsPortal').collection('doctors');
const paymentsCollection = client.db('doctorsPortal').collection('payments');

const verifyAdmin = async (req, res, next) => {
    const decodedEmail = req.decoded.email;
    const user = await usersCollection.findOne({ email: decodedEmail });

    if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden Access' });
    }
    next();
}

// ------------End Points------------

// ---------Root End-Points-----------
app.get('/', (req, res) => {
    try {
        res.send({
            success: true,
            message: 'Doctors Server is Running.....'
        })
    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})
// -----------------------------------------------

app.get('/manageDoctors', verifyJWT, verifyAdmin, async (req, res) => {
    try {
        const doctors = await doctorsCollection.find({}).toArray();
        res.send(doctors);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.post('/addDoctors', verifyJWT, verifyAdmin, async (req, res) => {
    try {
        const doctor = req.body;
        const result = await doctorsCollection.insertOne(doctor);
        res.send(result);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.delete('/deleteDoctor/:id', verifyJWT, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const result = await doctorsCollection.deleteOne({ _id: ObjectId(id) })
        res.send(result);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.get('/appointmentOptions', async (req, res) => {
    try {
        const date = req.query.date;
        const query = {};
        const options = await appointmentCollection.find(query).toArray();

        const bookingQuery = { appointmentDate: date }
        const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();
        options.forEach(option => {
            const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)
            const bookedSlots = optionBooked.map(book => book.slot)
            const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
            option.slots = remainingSlots;
        })
        res.send(options);

        // if (data) {
        //     res.send({
        //         success: true,
        //         message: 'Get the Data Successfully',
        //         data: data
        //     })
        // }
        // else {
        //     res.send({
        //         success: false,
        //         error: 'Data did not found.'
        //     })
        // }

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.get('/v2/appointmentOptions', async (req, res) => {
    try {
        const date = req.query.date;
        const options = await appointmentCollection.aggregate([
            {
                $lookup: {
                    from: 'bookings',
                    localField: 'name',
                    foreignField: 'treatment',
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$appointmentDate', date]
                                }
                            }
                        }
                    ],
                    as: 'booked'
                }
            },
            {
                $project: {
                    name: 1,
                    slots: 1,
                    booked: {
                        $map: {
                            input: '$booked',
                            as: 'book',
                            in: '$$book.slot'
                        }
                    }
                }
            },
            {
                $project: {
                    name: 1,
                    slots: {
                        $setDifference: ['$slots', '$booked']
                    }
                }
            }
        ]).toArray();
        res.send(options);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

// Specialty API
app.get('/specialty', async (req, res) => {
    try {
        const result = await appointmentCollection.find({}).project({ name: 1 }).toArray();
        res.send(result);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.get('/bookings', verifyJWT, async (req, res) => {
    try {
        const email = req.query.email;
        const decodedEmail = req.decoded.email;
        if (email !== decodedEmail) {
            return res.status(403).send({ message: 'Unauthorized Access' });
        }

        const query = { email: email }

        const bookings = await bookingCollection.find(query).toArray();
        res.send(bookings)

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.get('/bookings/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: ObjectId(id) };
        const data = await bookingCollection.findOne(query);
        res.send(data);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.post('/bookings', async (req, res) => {
    try {
        const booking = req.body;
        const query = {
            appointmentDate: booking.appointmentDate,
            treatment: booking.treatment,
            email: booking.email
        }

        const alreadyBooked = await bookingCollection.find(query).toArray();
        if (alreadyBooked.length) {
            const message = `You already have a booking on ${booking.appointmentDate}`
            return res.send({ acknowledged: false, message })
        }

        const data = await bookingCollection.insertOne(booking);
        res.send(data);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.get('/users', async (req, res) => {
    try {
        const query = {};
        const users = await usersCollection.find(query).toArray();
        res.send(users);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.get('/users/admin/:email', async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    res.send({ isAdmin: user?.role === 'admin' });
})

app.post('/users', async (req, res) => {
    try {
        const user = req.body;
        const data = await usersCollection.insertOne(user);
        res.send(data);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

// ------------Update Admin Role-------------
app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: ObjectId(id) };
    const option = { upsert: true };

    const updatedDoc = {
        $set: {
            role: 'admin'
        }
    }
    const result = await usersCollection.updateOne(filter, updatedDoc, option);
    res.send(result);
})


//  Add Price After development
// app.get('/addPrice', async (req, res) => {
//     try {
//         const filter = {};
//         const options = { upsert: true }
//         const updatedDoc = {
//             $set: {
//                 price: 99
//             }
//         }
//         const result = await appointmentCollection.updateMany(filter, updatedDoc, options);
//         res.send(result);

//     } catch (error) {
//         res.send({
//             success: false,
//             error: error.message
//         })
//     }
// })

// Payment GateWay Api
app.post('/create-payment-intent', async (req, res) => {
    try {
        const booking = req.body;
        const price = booking.price;
        const amount = price * 100;

        const paymentIntent = await stripe.paymentIntents.create({
            currency: 'usd',
            amount: amount,
            "payment_method_types": ["card"],
        });
        res.send({
            clientSecret: paymentIntent.client_secret,
        });

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

app.post('/payments', async (req, res) => {
    try {
        const payment = req.body;
        const result = await paymentsCollection.insertOne(payment);

        const id = payment.bookingId;
        const filter = { _id: ObjectId(id) };
        const updatedDoc = {
            $set: {
                paid: true,
                transactionId: payment.transactionId
            }
        }
        const updatedResult = await bookingCollection.updateOne(filter, updatedDoc)

        res.send(result);

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

// ---------Json Web Token Generate---------
app.get('/jwt', async (req, res) => {
    try {
        const email = req.query.email;
        const query = { email: email }
        const user = await usersCollection.findOne(query);

        if (user) {
            const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
            return res.send({ accessToken: token })
        }
        res.status(403).send({ accessToken: '' })

    } catch (error) {
        res.send({
            success: false,
            error: error.message
        })
    }
})

// -------------Server Running-------------
app.listen(port, () => {
    console.log(`Server is Running on Port: ${port}`);
})