const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const db = process.env.DATABASE_URL;
const secret = process.env.JWT_SECRET;
const name = process.env.APP_NAME || 'shop';
const flag = process.env.FEATURE_FLAG ?? 'off';
app.listen(port, '0.0.0.0', () => console.log('up'));
