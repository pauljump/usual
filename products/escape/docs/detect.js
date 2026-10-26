/* Tells the visitor which browser they are actually in, so the page proves the
   point on itself. Runs entirely locally -- no network, no storage. */
(function () {
  'use strict';

  var APPS = [
    [/Twitter/i, 'X'], [/Instagram/i, 'Instagram'],
    [/Messenger(?:ForiOS|Lite)|\bMessenger\b/i, 'Messenger'],
    [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, 'Facebook'],
    [/musical_ly|Bytedance|TikTok/i, 'TikTok'], [/Barcelona/i, 'Threads'],
    [/Reddit\//i, 'Reddit'], [/WhatsApp/i, 'WhatsApp'],
    [/LinkedInApp/i, 'LinkedIn'], [/Pinterest/i, 'Pinterest'],
    [/Snapchat/i, 'Snapchat'], [/\bLine\//i, 'LINE'],
    [/MicroMessenger/i, 'WeChat'], [/KAKAOTALK/i, 'KakaoTalk'],
    [/GSA\//i, 'the Google app'], [/\bSlack\b/i, 'Slack'], [/Discord/i, 'Discord']
  ];

  var el = document.getElementById('verdict');
  if (!el) return;

  var ua = navigator.userAgent || '';
  var app = null;
  for (var i = 0; i < APPS.length; i++) {
    if (APPS[i][0].test(ua)) { app = APPS[i][1]; break; }
  }

  if (app) {
    el.className = 'verdict inapp';
    el.textContent = 'You are inside ' + app + '’s browser right now. ' +
      'You did not choose it — so the card just appeared.';
  } else {
    el.className = 'verdict clean';
    el.textContent = 'You are in a real browser, so nothing happened. ' +
      'That is the point: it stays out of the way until it is needed.';
    var p = document.createElement('p');
    p.className = 'small';
    p.textContent = 'To see it work, post this page’s link on X and open ' +
      'it from the app.';
    el.parentNode.insertBefore(p, el.nextSibling);
  }
})();
