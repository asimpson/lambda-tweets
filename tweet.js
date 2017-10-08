'use strict';

const aws = require('aws-sdk');
const format = require('date-fns/format');
const Twit = require('twit');
const sql = require('sqlite3');
const fs = require('fs');
const type = require('content-type-mime');

const SOCIAL = `/tmp/${process.env.filename}`;
const s3 = new aws.S3({ region: 'us-east-1' });

const T = new Twit({
  consumer_key: process.env.consumer_key,
  consumer_secret: process.env.consumer_secret,
  access_token: process.env.access_token,
  access_token_secret: process.env.access_token_secret,
});

const post = (status, mediaIdStr, reply) =>
  new Promise((resolve, reject) => {
    const payload = {
      status,
      media_ids: mediaIdStr,
      in_reply_to_status_id: reply,
    };
    T.post('statuses/update', payload, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });

const saveInstagram = info =>
  new Promise((resolve, reject) => {
    s3.getObject(
      {
        Bucket: process.env.dbBucket,
        Key: process.env.filename,
      },
      (err, data) => {
        if (err) {
          reject(err);
        }
        fs.writeFileSync(SOCIAL, data.Body);
        const db = new sql.Database(SOCIAL);
        db.run(
          'INSERT into social VALUES($date, $post, $twitter, $instagram, $tweet_urls, $tweet_id, $instagram_id)',
          {
            $date: format(new Date(), 'YYYY-MM-DD H:mm:ss Z'),
            $post: info.text,
            $twitter: 0,
            $instagram: 1,
            $tweet_urls: '',
            $tweet_id: null,
            $instagram_id: info.id,
          },
          function instagramSave(insertErr) {
            if (insertErr) {
              reject(insertErr);
            } else {
              console.log(this);
              const Body = fs.readFileSync(SOCIAL);
              const params = {
                Bucket: process.env.dbBucket,
                Key: process.env.filename,
                Body,
              };

              s3.putObject(params, putErr => {
                if (putErr) {
                  reject(putErr);
                } else {
                  resolve();
                }
              });
            }
          }
        );
      }
    );
  });

const saveTweet = tweets =>
  new Promise((resolve, reject) => {
    s3.getObject(
      {
        Bucket: process.env.dbBucket,
        Key: process.env.filename,
      },
      (err, data) => {
        if (err) {
          reject(err);
        }
        fs.writeFileSync(SOCIAL, data.Body);
        const db = new sql.Database(SOCIAL);
        db.run(
          'INSERT into social VALUES($date, $post, $twitter, $instagram, $tweet_urls, $tweet_id, $instagram_id)',
          {
            $date: format(tweets.created_at, 'YYYY-MM-DD H:mm:ss Z'),
            $post: tweets.text,
            $twitter: 1,
            $instagram: 0,
            $tweet_urls: JSON.stringify(tweets.entities.urls),
            $tweet_id: parseInt(tweets.id_str, 10),
            $instagram_id: '',
          },
          function tweetSave(insertErr) {
            if (insertErr) {
              reject(insertErr);
            } else {
              console.log(this);
              const Body = fs.readFileSync(SOCIAL);
              const params = {
                Bucket: process.env.dbBucket,
                Key: process.env.filename,
                Body,
              };

              s3.putObject(params, putErr => {
                if (putErr) {
                  reject(putErr);
                } else {
                  resolve();
                }
              });
            }
          }
        );
      }
    );
  });

const uploadImageToTwitter = (img, altText) =>
  new Promise((resolve, reject) => {
    T.post('media/upload', { media_data: img }, (err, data) => {
      const mediaIdStr = data.media_id_string;
      const metaParams = { media_id: mediaIdStr, alt_text: { text: altText } };

      T.post('media/metadata/create', metaParams, createErr => {
        if (!createErr) {
          resolve(mediaIdStr);
        } else {
          reject(createErr);
        }
      });
    });
  });

const uploadImageToS3 = (image, Key, data) =>
  new Promise((resolve, reject) => {
    const Body = new Buffer(image, 'base64');
    const params = {
      Bucket: process.env.mediaBucket,
      ACL: 'public-read',
      Key: `images/social/${Key}`,
      ContentType: type(Key),
      Body,
    };

    s3.putObject(params, err => {
      if (err) {
        reject(err);
      } else {
        resolve(data || {});
      }
    });
  });

const tweet = (event, context, cb) => {
  if (event.network === 'twitter') {
    if (event.image) {
      uploadImageToTwitter(event.image, event.alt)
        .then(x => post(event.status, x, event.reply))
        .then(x => uploadImageToS3(event.image, x.id_str, x))
        .then(x => saveTweet(x))
        .then(() => cb(null, '🚀'))
        .catch(err => cb(`🔥 ${JSON.stringify(err.stack)}`));
    } else {
      post(event.status, '', event.reply)
        .then(x => saveTweet(x))
        .then(() => cb(null, '🚀'))
        .catch(err => cb(`🔥 ${JSON.stringify(err.stack)}`));
    }
  }

  if (event.network === 'instagram') {
    uploadImageToS3(event.image, event.instagram_id)
      .then(() => saveInstagram({ id: event.instagram_id, text: event.status }))
      .then(() => cb(null, '✨'))
      .catch(err => cb(`🔥 ${JSON.stringify(err.stack)}`));
  }
};

exports.handler = tweet;
