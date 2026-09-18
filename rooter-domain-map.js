// Rooter 内网文档链接 -> 外网链接 自动重写
(function () {
  'use strict';

  // 域名映射表：内网域名 -> 外网域名
  var DOMAIN_MAP = {
    'rooter.mcd.ai': 'rooter.mcdonalds.cn'
  };

  function rewrite(url) {
    if (!url) return url;
    try {
      var u = new URL(url, window.location.href);
      var mapped = DOMAIN_MAP[u.hostname];
      if (mapped) {
        u.hostname = mapped;
        return u.href;
      }
    } catch (e) {
      /* 非法 URL，保持原样 */
    }
    return url;
  }

  function rewriteAnchors(root) {
    var anchors = (root || document).querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var original = a.getAttribute('href');
      var rewritten = rewrite(original);
      if (rewritten !== original) {
        a.setAttribute('href', rewritten);
      }
    }
  }

  // 点击兜底：即使链接是动态拼接、href 属性没被提前改到，也在点击瞬间改写
  document.addEventListener(
    'click',
    function (e) {
      var target = e.target;
      var a = target && target.closest ? target.closest('a[href]') : null;
      if (!a) return;
      var original = a.getAttribute('href');
      var rewritten = rewrite(original);
      if (rewritten !== original) {
        a.setAttribute('href', rewritten);
      }
    },
    true
  );

  // 初始改写
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      rewriteAnchors(document);
    });
  } else {
    rewriteAnchors(document);
  }

  // 监听动态渲染的链接
  var timer = null;
  var observer = new MutationObserver(function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      rewriteAnchors(document);
    }, 300);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href']
  });
})();
