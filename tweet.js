'use strict';

const aws = require('aws-sdk');
const moment = require('moment');
const Twit = require('twit');
const sql = require('sqlite3');
const fs = require('fs');

const TWEETS = `/tmp/${process.env.filename}`;
const s3 = new aws.S3({ region: 'us-east-1' });

const T = new Twit({
  consumer_key: process.env.consumer_key,
  consumer_secret: process.env.consumer_secret,
  access_token: process.env.access_token,
  access_token_secret: process.env.access_token_secret,
});

const post = (status, mediaIdStr) => new Promise((resolve, reject) => {
  const payload = { status, media_ids: mediaIdStr };
  T.post('statuses/update', payload, (err, data) => {
    if (err) {
      reject(err);
    } else {
      resolve(data);
    }
  });
});

const saveToDB = tweets => new Promise((resolve, reject) => {
  s3.getObject({
    Bucket: process.env.dbBucket,
    Key: process.env.filename,
  }, (err, data) => {
    if (err) {
      reject(err);
    }
    fs.writeFileSync(TWEETS, data.Body);
    const db = new sql.Database(TWEETS);
    db.run('INSERT into tweets VALUES($tweet_id, $tweet, $date, $included_urls)', {
      $tweet_id: tweets.id,
      $tweet: tweets.text,
      $date: moment(tweets.created_at).format('YYYY-MM-DD H:mm:ss Z'),
      $included_urls: JSON.stringify(tweets.entities.urls),
    }, function tweetSave(insertErr) {
      if (insertErr) {
        reject(insertErr);
      } else {
        console.log(this);
        const Body = fs.readFileSync(TWEETS);
        const params = {
          Bucket: process.env.dbBucket,
          Key: process.env.filename,
          Body,
        };

        s3.putObject(params, (putErr) => {
          if (putErr) {
            reject(putErr);
          } else {
            resolve();
          }
        });
      }
    });
  });
});

const uploadImageToTwitter = (img, altText) => new Promise((resolve, reject) => {
  T.post('media/upload', { media_data: img }, (err, data) => {
    const mediaIdStr = data.media_id_string;
    const metaParams = { media_id: mediaIdStr, alt_text: { text: altText } };

    T.post('media/metadata/create', metaParams, (createErr) => {
      if (!createErr) {
        resolve(mediaIdStr);
      } else {
        reject(createErr);
      }
    });
  });
});

const uploadImageToS3 = (image, data) => new Promise((resolve, reject) => {
  const Body = new Buffer(image, 'base64');
  const params = {
    Bucket: process.env.mediaBucket,
    Key: data.id_str,
    Body,
  };

  s3.putObject(params, (err) => {
    if (err) {
      reject(err);
    } else {
      resolve(data);
    }
  });
});

const tweet = (event, context, cb) => {
  if (event.image) {
    uploadImageToTwitter(event.image, event.alt)
    .then(x => post(event.status, x))
    .then(x => uploadImageToS3(event.image, x))
    .then(x => saveToDB(x))
    .then(() => cb(null, '🚀'))
    .catch(err => cb(`🔥 ${JSON.stringify(err.stack)}`));
  } else {
    post(event.status)
    .then(x => saveToDB(x))
    .then(() => cb(null, '🚀'))
    .catch(err => cb(`🔥 ${JSON.stringify(err.stack)}`));
  }
};

exports.handler = tweet;
