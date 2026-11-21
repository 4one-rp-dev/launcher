// Тексты, которые рисует сам Electron (трей, системные диалоги). Остальное переводит рендерер (renderer/js/i18n-en.js).
const EN = { 'Открыть лаунчер': 'Open launcher', 'Выход': 'Quit', 'Папка с GTA V': 'GTA V folder', 'Новость 4ONE RP': '4ONE RP news', 'Сервер снова доступен — можно заходить': 'The server is back online — you can join' };
const mt = (lang, key) => (lang === 'en' && EN[key]) || key;
module.exports = { mt, EN };
