// Тренажёр «Прописи по уроку» в интерфейсе okchinese: вся логика страницы.
//
// Как читать этот файл (сверху вниз):
//   1. Пять шагов и три режима сайта
//   2. Состояние: что на экране и что уже пройдено
//   3. Мелкие помощники
//   4. Экраны: урок, разбор иероглифа, письмо, итог
//   5. Письмо: работа с библиотекой Hanzi Writer
//   6. Кнопки
//   7. Запуск


/* ---------- 1. Пять шагов: чем дальше, тем меньше подсказок ---------- */

// outline    — контур иероглифа: "full" виден, "faint" бледный, "none" скрыт
// lead       — подсвечивать следующую черту заранее
// hintAfter  — после скольких ошибок на одной черте показать её (false — никогда)
// colored    — красить написанные черты цветами ключа и фонетика
const STEPS = [
  {
    name: "По образцу",
    rule: "Обводи контур. Следующая черта подсвечивается заранее.",
    outline: "full", lead: true, hintAfter: 1, colored: true,
  },
  {
    name: "По контуру",
    rule: "Контур на месте. Подсветка появится после первой ошибки.",
    outline: "full", lead: false, hintAfter: 1, colored: true,
  },
  {
    name: "Бледный контур",
    rule: "Контур побледнел. Подсветка появится после двух ошибок.",
    outline: "faint", lead: false, hintAfter: 2, colored: true,
  },
  {
    name: "Без контура",
    rule: "Контура нет. Подсветка появится после трёх ошибок.",
    outline: "none", lead: false, hintAfter: 3, colored: false,
  },
  {
    name: "По памяти",
    rule: "Ни контура, ни подсветки. Можно подсмотреть, но тогда иероглиф уйдёт на повторение.",
    outline: "none", lead: false, hintAfter: false, colored: false,
  },
];
const LAST_STEP = STEPS.length - 1;

// Три режима сайта («Изучение», «Практика», «Проверка знаний») становятся
// тремя этапами одной тренировки: каждый объединяет свои шаги.
const MODES = [
  { name: "Изучение", steps: [0, 1] },
  { name: "Практика", steps: [2, 3] },
  { name: "Проверка знаний", steps: [4] },
];
const modeOf = (step) => MODES.findIndex((mode) => mode.steps.includes(step));

// Статусы иероглифа — те же слова, что на сайте.
const STATUS = {
  "": { label: "Не изучен", tone: "" },
  learning: { label: "Изучается", tone: "learning" },
  learned: { label: "Изучен", tone: "learned" },
  review: { label: "На повторение", tone: "review" },
};
const FILTERS = [
  { value: "all", label: "Все" },
  { value: "", label: "Не изучены" },
  { value: "learning", label: "Изучаются" },
  { value: "learned", label: "Изучены" },
  { value: "review", label: "Требуют повторения" },
];


/* ---------- 2. Состояние ---------- */

const CHARS = LESSON.characters;              // иероглифы урока из lesson.js
const STORAGE_KEY = "okchinese-proto-v2";     // под этим именем браузер хранит прогресс
const SCREENS = ["lesson", "intro", "write", "done"];
const EMPTY_PROGRESS = { results: {}, exercises: 0 };

const state = {
  screen: "lesson",         // какой экран открыт
  tab: "lessons",           // вкладка на экране урока: "lessons" или "review"
  filter: "all",            // фильтр «Прогресс»
  index: 0,                 // какой по счёту иероглиф урока
  step: 0,                  // какой шаг письма идёт
  progress: loadProgress(), // { results: { "惯": { mistakes, peeked, status } }, exercises: 7 }
};

let writer = null;       // поле для письма (объект библиотеки Hanzi Writer)
let attempt = null;      // ход текущего шага: какая черта на очереди, подсматривал ли ученик
let advanceTimer = 0;    // пауза перед переходом к следующему шагу
let sheetSize = 0;       // сторона листа в пикселях
let started = false;
let resetArmed = false;  // «Сбросить» нажали один раз: ждём подтверждения
let resetTimer = 0;      // через сколько кнопка снова станет обычной
let leadTimer = 0;       // повтор подсветки следующей черты на шаге «По образцу»

const RESET_CONFIRM_MS = 4000;   // сколько ждём второго касания по «Сбросить»
// Скорость подсветки черты. У библиотеки по умолчанию 2: черта мигает за треть
// секунды, и её почти не видно. При 0,6 черта прорисовывается около секунды.
const HIGHLIGHT_SPEED = 0.6;
const LEAD_REPEAT_MS = 3000;     // как часто повторять подсветку, пока ученик думает
const ADVANCE_MS = 1100;         // пауза после шага перед следующим

// Прогресс хранится в браузере ученика. На сайте он лежал бы в аккаунте.
// Если хранилище недоступно (например, приватное окно), работаем без памяти.
function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved.results === "object" && saved.results !== null) {
      return { results: saved.results, exercises: Number(saved.exercises) || 0 };
    }
  } catch (error) {
    /* хранилище недоступно или испорчено — начинаем с нуля */
  }
  return EMPTY_PROGRESS;
}
function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  } catch (error) {
    /* без памяти тоже работаем */
  }
}


/* ---------- 3. Мелкие помощники ---------- */

const app = document.getElementById("app");
const current = () => CHARS[state.index];
const resultOf = (ch) => state.progress.results[ch.char];
const statusOf = (ch) => (resultOf(ch) || {}).status || "";
const countStatus = (status) => CHARS.filter((ch) => statusOf(ch) === status).length;
const inLesson = (char) => CHARS.some((ch) => ch.char === char);
const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const lessonShort = () => LESSON.title.split(":")[0];

// Делает текст безопасным для вставки в страницу.
const esc = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Читает значение цвета по имени из блока :root в index.html.
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const roleVar = (role, onPaper) =>
  "var(--" + (role === "sound" ? "sound" : "meaning") + (onPaper ? "-ink" : "") + ")";
const roleToken = (role) => css(role === "sound" ? "--sound-ink" : "--meaning-ink");

// «1 ошибка, 2 ошибки, 5 ошибок»
function plural(n, one, few, many) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
function mistakesText(n) {
  if (n === undefined || n === null) return "—";
  if (n === 0) return "без ошибок";
  return n + " " + plural(n, "ошибка", "ошибки", "ошибок");
}

// Следующий не выученный иероглиф после from (по кругу). -1 — все выучены.
function nextToDo(from) {
  for (let k = 1; k < CHARS.length; k += 1) {
    const i = (from + k) % CHARS.length;
    if (statusOf(CHARS[i]) !== "learned") return i;
  }
  return -1;
}
// С чего начать тренировку: сначала то, что на повторении, потом новое.
function firstToTrain() {
  const review = CHARS.findIndex((ch) => statusOf(ch) === "review");
  if (review !== -1) return review;
  const fresh = CHARS.findIndex((ch) => statusOf(ch) !== "learned");
  return fresh === -1 ? 0 : fresh;
}

// Разлиновка листа: крест и две диагонали пунктиром.
const GUIDES =
  '<svg class="paper__guides" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
  '<path d="M50 0V100M0 50H100M0 0L100 100M100 0L0 100"></path></svg>';

// Рисует иероглиф из данных о чертах (strokes.js).
// colorOf — необязательная функция «номер черты → цвет».
function glyph(char, colorOf) {
  const data = STROKES[char];
  if (!data) return '<span class="glyph glyph--font hanzi" lang="zh-Hans">' + esc(char) + "</span>";
  const place = HanziWriter.getScalingTransform(100, 100, 10);
  const paths = data.strokes
    .map((d, i) => '<path d="' + d + '" style="fill:' + (colorOf ? colorOf(i) : "var(--text)") + '"></path>')
    .join("");
  return (
    '<svg class="glyph" viewBox="0 0 100 100" role="img" aria-label="' + esc(char) + '">' +
    '<g transform="' + place.transform + '">' + paths + "</g></svg>"
  );
}

// Цвет черты на белом листе по тому, к какой части иероглифа она относится.
function partColors(ch) {
  return (i) => {
    const part = ch.parts.find((p) => p.strokes.includes(i));
    return part ? roleVar(part.role, true) : "var(--paper-ink)";
  };
}

function badge(ch) {
  const status = STATUS[statusOf(ch)];
  return '<span class="badge' + (status.tone ? " badge--" + status.tone : "") + '">' + status.label + "</span>";
}


/* ---------- 4. Экраны ---------- */
// Каждая функция view… возвращает кусок страницы в виде текста.
// Кнопки помечены data-action="…": по этому имени раздел 6 понимает, что делать.

// Шапка экранов тренировки — как у панели тренажёра на сайте: слева что открыто,
// справа «Назад».
function topBar(titleHtml, sub, backAction) {
  return `
    <header class="top">
      <div>
        <p class="top__title">${titleHtml}</p>
        <p class="top__sub">${esc(sub)}</p>
      </div>
      <button class="link" type="button" data-action="${backAction}">Назад</button>
    </header>`;
}

function tabsBar() {
  const review = countStatus("review");
  const item = (tab, label, extra) =>
    `<button class="tabs__item${state.tab === tab ? " is-active" : ""}" type="button" data-action="tab" data-tab="${tab}">${label}${extra || ""}</button>`;
  const off = (label) =>
    `<button class="tabs__item" type="button" disabled title="В прототипе не работает">${label}</button>`;
  return `
    <nav class="tabs" aria-label="Разделы тренажёра">
      ${off("По уровням HSK 3.0")}
      ${item("lessons", "Мои уроки")}
      ${item("review", "На повторение", review ? `<span class="tabs__count">${review}</span>` : "")}
      ${off("Своя подборка")}
    </nav>`;
}

function tilesList(list) {
  return `<ul class="tiles">${list
    .map(({ ch, i }) => `
      <li>
        <button class="tile" type="button" data-action="open" data-index="${i}">
          <span class="tile__glyph">${glyph(ch.char)}</span>
          <span class="tile__pinyin pinyin">${esc(ch.pinyin)}</span>
          <span class="tile__ru">${esc(ch.short)}</span>
          ${badge(ch)}
        </button>
      </li>`)
    .join("")}</ul>`;
}

function lessonsBlock() {
  const list = CHARS.map((ch, i) => ({ ch, i }))
    .filter(({ ch }) => state.filter === "all" || statusOf(ch) === state.filter);
  const lessons = [`<option selected>${esc(LESSON.title)}</option>`]
    .concat(LESSON.otherLessons.map((title) => `<option disabled>${esc(title)} — в прототипе нет</option>`))
    .join("");
  const filters = FILTERS.map((f) =>
    `<option value="${f.value}"${f.value === state.filter ? " selected" : ""}>${f.label}</option>`).join("");
  const route = MODES.map((mode) => {
    const nums = mode.steps.map((s) => s + 1);
    const steps = nums.length > 1 ? "шаги " + nums.join("–") : "шаг " + nums[0];
    return `<li><span class="route__name">${mode.name}</span><span class="route__steps">${steps}</span></li>`;
  }).join("");

  return `
    <h2 class="h2">Иероглифы из уроков <span class="h2__count">${CHARS.length}</span></h2>
    <div class="controls">
      <label class="field"><span class="field__label">Урок</span>
        <select class="select" aria-label="Урок">${lessons}</select></label>
      <label class="field"><span class="field__label">Прогресс</span>
        <select class="select" data-change="filter" aria-label="Прогресс">${filters}</select></label>
    </div>
    <ol class="route" aria-label="Этапы тренировки">${route}</ol>
    <p class="from-cards">Чтение и перевод подтянуты из ваших «Карточек».</p>
    ${list.length ? tilesList(list) : '<p class="empty">С таким прогрессом в уроке иероглифов нет.</p>'}`;
}

function reviewBlock() {
  const list = CHARS.map((ch, i) => ({ ch, i })).filter(({ ch }) => statusOf(ch) === "review");
  return `
    <h2 class="h2">На повторение <span class="h2__count">${list.length}</span></h2>
    <p class="subtitle">Сюда попадают иероглифы, которые на «Проверке знаний» написаны с ошибкой или с подсказкой.</p>
    ${list.length ? tilesList(list) : '<p class="empty">Пока пусто. Всё, что написано по памяти без ошибок, засчитывается в «Изучено».</p>'}`;
}

function resetButton() {
  return resetArmed
    ? '<button class="btn btn--danger btn--auto" type="button" data-action="reset">Точно сбросить?</button>'
    : '<button class="btn btn--secondary btn--auto" type="button" data-action="reset">Сбросить</button>';
}

// Экран урока: шапка вкладки «Иероглифы», счётчики, вкладки, плитки.
function viewLesson() {
  const touched = CHARS.some((ch) => resultOf(ch));
  return `
    <main class="body body--scroll" id="pageScroll">
      <p class="proto">Прототип для okchinese: так тренажёр выглядел бы во вкладке «Иероглифы». Меню и логотипа сайта здесь нет.</p>
      <header class="page-head">
        <h1 class="title">Тренажёр написания китайских иероглифов онлайн</h1>
        <p class="subtitle">Разберите, из чего состоит иероглиф, и напишите его пять раз: с каждым разом подсказок меньше.</p>
      </header>
      <div class="badges">
        <span class="badge">Изучено: ${countStatus("learned")}</span>
        <span class="badge">Для повторения: ${countStatus("review")}</span>
        <span class="badge">Выполнено упражнений: ${state.progress.exercises}</span>
      </div>
      ${tabsBar()}
      ${state.tab === "review" ? reviewBlock() : lessonsBlock()}
    </main>
    <footer class="actions">
      ${touched ? resetButton() : ""}
      <button class="btn" type="button" data-action="train">Начать тренировку</button>
    </footer>`;
}

// Экран разбора: чтение, перевод, слово из урока и части иероглифа.
function viewIntro() {
  const ch = current();
  const parts = ch.parts.map((part) => {
    const also = part.seeAlso.map((item) => {
      const here = inLesson(item.c) && item.c !== ch.char;
      return `
        <li class="also__item${here ? " also__item--lesson" : ""}">
          <span class="also__zh hanzi" lang="zh-Hans">${esc(item.c)}</span>
          <span class="also__py">${esc(item.p)}</span>
          <span class="also__ru">${esc(item.m)}${here ? ' · <span class="also__tag">в уроке</span>' : ""}</span>
        </li>`;
    }).join("");
    return `
      <li class="part part--${part.role}">
        <span class="part__glyph hanzi" lang="zh-Hans">${esc(part.glyph)}</span>
        <div>
          <p class="part__role">${part.role === "sound" ? "Фонетик · звучание" : "Ключ · смысл"}</p>
          <p><span class="pinyin">${esc(part.pinyin)}</span> · ${esc(part.meaning)}</p>
        </div>
        <div class="part__also">
          <p class="also__label">Ещё встречается в</p>
          <ul class="also">${also}</ul>
        </div>
      </li>`;
  }).join("");

  return `
    ${topBar(esc(lessonShort()), (state.index + 1) + " из " + CHARS.length, "lesson")}
    <main class="body body--scroll">
      <section class="char-head">
        <div class="paper">${GUIDES}<div class="paper__layer" id="introGlyph">${glyph(ch.char, partColors(ch))}</div></div>
        <div class="char-head__text">
          <p class="pinyin pinyin--xl">${esc(ch.pinyin)}</p>
          <p class="meaning">${esc(ch.meaning)}</p>
          <p class="example"><span class="hanzi" lang="zh-Hans">${esc(ch.word.zh)}</span> <span class="pinyin">${esc(ch.word.pinyin)}</span> — ${esc(ch.word.ru)} <span class="example__tag">· из урока</span></p>
        </div>
      </section>
      <section class="makeup">
        <h2 class="h2">Из чего состоит</h2>
        <p class="kind">${esc(ch.kind)}</p>
        <ul class="parts">${parts}</ul>
        <p class="note">${esc(ch.note)}</p>
      </section>
    </main>
    <footer class="actions">
      <button class="btn btn--secondary" type="button" data-action="animate">Порядок черт</button>
      <button class="btn" type="button" data-action="write">Писать</button>
    </footer>`;
}

// Экран письма: режим сайта, полоска шагов, лист и две кнопки.
function viewWrite() {
  const ch = current();
  const step = STEPS[state.step];
  const now = modeOf(state.step);
  const modes = MODES.map((mode, i) =>
    `<li class="${i < now ? "is-done" : i === now ? "is-now" : ""}">${mode.name}</li>`).join("");
  const bar = STEPS.map((s, i) => {
    const cls = i < state.step ? "is-done" : i === state.step ? "is-now" : "";
    const gap = i === 1 || i === 3 ? '<li class="gap"></li>' : "";
    return `<li class="${cls}"></li>${gap}`;
  }).join("");

  return `
    ${topBar(`<span class="hanzi" lang="zh-Hans">${esc(ch.char)}</span> · <span class="pinyin">${esc(ch.pinyin)}</span>`, ch.meaning, "intro")}
    <main class="body body--write">
      <ol class="modes" aria-label="Режим">${modes}</ol>
      <div class="steps">
        <ol class="steps__bar" aria-hidden="true">${bar}</ol>
        <p class="steps__name">Шаг ${state.step + 1} из ${STEPS.length} · ${step.name}</p>
        <p class="steps__rule">${step.rule}</p>
      </div>
      <div class="stage" id="stage">
        <div class="paper" id="sheet">${GUIDES}<div class="paper__layer" id="writerTarget"></div></div>
        <p class="status" id="status" aria-live="polite"></p>
      </div>
    </main>
    <footer class="actions">
      <button class="btn btn--secondary" type="button" data-action="hint">${state.step === LAST_STEP ? "Подсмотреть" : "Подсказка"}</button>
      <button class="btn btn--secondary" type="button" data-action="restart">Начать заново</button>
    </footer>`;
}

// Экран итога по одному иероглифу: статус и ошибки по режимам.
function viewDone() {
  const ch = current();
  const result = resultOf(ch);
  const clean = result.status === "learned";
  const next = nextToDo(state.index);

  let verdict = "Написан по памяти без ошибок и засчитан в «Изучено».";
  if (!clean) {
    const how = [];
    const n = result.mistakes[LAST_STEP] || 0;
    if (n) how.push(mistakesText(n));
    if (result.peeked) how.push("с подсказкой");
    verdict = "Проверка знаний: " + how.join(", ") + ". Иероглиф попал во вкладку «На повторение».";
  }
  const report = MODES.map((mode) => `
    <section class="report__mode">
      <h3>${mode.name}</h3>
      <ul>${mode.steps.map((i) => `<li><span>${STEPS[i].name}</span><span>${mistakesText(result.mistakes[i])}</span></li>`).join("")}</ul>
    </section>`).join("");

  return `
    ${topBar(esc(lessonShort()), (state.index + 1) + " из " + CHARS.length, "lesson")}
    <main class="body body--scroll body--result">
      <div class="paper paper--result">${GUIDES}<div class="paper__layer">${glyph(ch.char, partColors(ch))}</div></div>
      <p class="pinyin pinyin--xl">${esc(ch.pinyin)}</p>
      <p class="meaning">${esc(ch.meaning)}</p>
      ${badge(ch)}
      <p class="verdict">${verdict}</p>
      <div class="report">${report}</div>
    </main>
    <footer class="actions">
      <button class="btn btn--secondary" type="button" data-action="again">Ещё раз по памяти</button>
      <button class="btn" type="button" data-action="next">${next === -1 ? "К уроку" : "Дальше: " + CHARS[next].char}</button>
    </footer>`;
}

// Показывает экран, который записан в state.screen.
function render() {
  clearTimeout(advanceTimer);
  stopLead();
  resizeWatcher.disconnect();
  writer = null;

  if (!window.HanziWriter) {
    app.innerHTML = '<p class="boot">Не загрузилась библиотека для письма. Проверь интернет и обнови страницу.</p>';
    return;
  }
  if (state.screen === "done" && !resultOf(current())) state.screen = "intro";

  const views = { lesson: viewLesson, intro: viewIntro, write: viewWrite, done: viewDone };
  app.classList.toggle("app--focus", state.screen !== "lesson");
  app.innerHTML = views[state.screen]();
  if (state.screen === "write") mountWrite();
  if (state.screen === "lesson") showActiveTab();
}

// Ряд вкладок шире телефона: прокручиваем его так, чтобы выбранная была видна.
function showActiveTab() {
  const tabs = app.querySelector(".tabs");
  const active = app.querySelector(".tabs__item.is-active");
  if (!tabs || !active) return;
  const overflow = active.offsetLeft + active.offsetWidth - tabs.clientWidth;
  tabs.scrollLeft = overflow > 0 ? overflow + 8 : 0;
}

// Перерисовка экрана урока без прыжка наверх (фильтр, вкладка, сброс).
function renderKeepScroll() {
  const before = document.getElementById("pageScroll");
  const top = before ? before.scrollTop : 0;
  render();
  const after = document.getElementById("pageScroll");
  if (after) after.scrollTop = top;
}


/* ---------- 5. Письмо ---------- */

const padOf = (size) => Math.round(size * 0.1);   // поля вокруг иероглифа на листе
const STATUS_ROOM = 52;                           // место под строку состояния под листом

// Сторона листа: меньшая из сторон свободного места (по высоте — за вычетом строки под листом).
function measureStage() {
  const stage = document.getElementById("stage");
  return Math.max(140, Math.floor(Math.min(stage.clientWidth, stage.clientHeight - STATUS_ROOM)));
}
function sizeSheet() {
  const sheet = document.getElementById("sheet");
  sheet.style.width = sheetSize + "px";
  sheet.style.height = sheetSize + "px";
}

// Если окно изменилось (повернули телефон, растянули окно) — лист подстраивается.
const resizeWatcher = new ResizeObserver(() => {
  if (state.screen !== "write" || !writer) return;
  const size = measureStage();
  if (Math.abs(size - sheetSize) < 2) return;
  sheetSize = size;
  sizeSheet();
  writer.updateDimensions({ width: size, height: size, padding: padOf(size) });
});

function mountWrite() {
  sheetSize = measureStage();
  sizeSheet();
  startStep();
  resizeWatcher.observe(document.getElementById("stage"));
}

// Общие настройки поля Hanzi Writer.
// Библиотека умеет красить только две группы черт: «ключ по словарю» (radStrokes)
// и все остальные. Поэтому смотрим, какая из наших частей совпадает с этим ключом.
function writerOptions(ch, size, colored) {
  const ink = css("--paper-ink");
  let strokeColor = ink;
  let radicalColor = ink;

  const rad = STROKES[ch.char].radStrokes || [];
  const radPart = ch.parts.find((p) => sameList(p.strokes, rad));
  const otherPart = ch.parts.find((p) => p !== radPart);
  if (colored && radPart && otherPart && ch.parts.length === 2) {
    radicalColor = roleToken(radPart.role);
    strokeColor = roleToken(otherPart.role);
  }

  return {
    width: size,
    height: size,
    padding: padOf(size),
    charDataLoader: (char) => STROKES[char],   // данные лежат в strokes.js, в сеть не ходим
    showCharacter: false,
    strokeColor,
    radicalColor,
    outlineColor: css("--trace"),
    drawingColor: ink,
    highlightColor: css("--highlight"),
    strokeHighlightSpeed: HIGHLIGHT_SPEED,
  };
}

// Шаг «По образцу»: подсвечиваем черту, которую писать следующей,
// и повторяем, пока ученик её не проведёт.
function startLead() {
  stopLead();
  const flash = () => {
    if (writer && attempt && !attempt.finished) writer.highlightStroke(attempt.stroke);
  };
  flash();
  leadTimer = setInterval(flash, LEAD_REPEAT_MS);
}
function stopLead() {
  clearInterval(leadTimer);
  leadTimer = 0;
}

// Запускает текущий шаг для текущего иероглифа.
function startStep() {
  const ch = current();
  const step = STEPS[state.step];
  const target = document.getElementById("writerTarget");
  target.innerHTML = "";
  attempt = { stroke: 0, total: STROKES[ch.char].strokes.length, peeked: false, finished: false };

  writer = HanziWriter.create(target, ch.char, {
    ...writerOptions(ch, sheetSize, step.colored),
    showOutline: step.outline !== "none",
    outlineColor: css(step.outline === "faint" ? "--trace-faint" : "--trace"),
    drawingWidth: Math.max(5, Math.round(sheetSize / 46)),
  });

  writer.quiz({
    showHintAfterMisses: step.hintAfter,
    highlightOnComplete: true,
    leniency: 1.15,   // чуть мягче стандартного: пальцем писать труднее, чем мышью

    onCorrectStroke(info) {
      attempt.stroke = info.strokeNum + 1;
      if (info.strokesRemaining > 0) {
        say("Черта " + (attempt.stroke + 1) + " из " + attempt.total);
        if (step.lead) startLead();
      }
    },
    onMistake(info) {
      const hinted = step.hintAfter !== false && info.mistakesOnStroke >= step.hintAfter;
      say(hinted ? "Смотри подсветку и повтори черту" : "Не так. Проверь, откуда и куда идёт черта", "bad");
      nudge();
    },
    onComplete(summary) {
      finishStep(summary.totalMistakes);
    },
  });

  say("Черта 1 из " + attempt.total);
  if (step.lead) startLead();
}

// Шаг пройден: записываем результат новой копией прогресса и идём дальше.
function finishStep(mistakes) {
  const ch = current();
  const last = state.step === LAST_STEP;
  const prev = resultOf(ch) || { mistakes: [], peeked: false, status: "" };
  const marks = prev.mistakes.slice();
  marks[state.step] = mistakes;

  const result = {
    mistakes: marks,
    peeked: last ? attempt.peeked : prev.peeked,
    status: last ? (mistakes === 0 && !attempt.peeked ? "learned" : "review") : prev.status || "learning",
  };
  state.progress = {
    results: { ...state.progress.results, [ch.char]: result },
    exercises: state.progress.exercises + 1,
  };
  attempt.finished = true;
  stopLead();
  saveProgress();

  say(mistakes ? "Шаг пройден: " + mistakesText(mistakes) : "Шаг пройден без ошибок", "ok");
  advanceTimer = setTimeout(() => {
    if (last) state.screen = "done";
    else state.step += 1;
    render();
  }, ADVANCE_MS);
}

// Строка под листом: что делать сейчас или что пошло не так.
function say(text, tone) {
  const status = document.getElementById("status");
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone || "";
}

// Лист вздрагивает при ошибке.
function nudge() {
  const sheet = document.getElementById("sheet");
  if (!sheet) return;
  sheet.classList.remove("is-nudged");
  void sheet.offsetWidth;   // перезапускает анимацию, если ошибки идут подряд
  sheet.classList.add("is-nudged");
}

// Кнопка «Порядок черт» на экране разбора: рисует иероглиф черта за чертой.
function playAnimation() {
  const ch = current();
  const box = document.getElementById("introGlyph");
  const size = box.clientWidth;
  box.innerHTML = "";
  const demo = HanziWriter.create(box, ch.char, {
    ...writerOptions(ch, size, true),
    showOutline: true,
    strokeAnimationSpeed: 1,
    delayBetweenStrokes: 250,
  });
  demo.animateCharacter();
}


/* ---------- 6. Кнопки ---------- */
// Имя слева совпадает с data-action у кнопки на странице.

function openChar(index) {
  state.index = index;
  state.step = 0;
  state.screen = "intro";
  render();
}

const actions = {
  open(button) {
    openChar(Number(button.dataset.index));
  },
  train() {
    openChar(firstToTrain());
  },
  tab(button) {
    state.tab = button.dataset.tab;
    renderKeepScroll();
  },
  lesson() {
    state.screen = "lesson";
    render();
  },
  intro() {
    state.screen = "intro";
    render();
  },
  write() {
    state.step = 0;
    state.screen = "write";
    render();
  },
  animate() {
    playAnimation();
  },
  hint() {
    if (!writer || !attempt || attempt.finished) return;
    if (state.step === LAST_STEP) {
      attempt.peeked = true;
      say("С подсказкой: иероглиф уйдёт на повторение");
    } else {
      say("Вот эта черта");
    }
    writer.highlightStroke(attempt.stroke);
  },
  restart() {
    render();
  },
  again() {
    state.step = LAST_STEP;
    state.screen = "write";
    render();
  },
  next() {
    const i = nextToDo(state.index);
    if (i !== -1) return openChar(i);
    state.screen = "lesson";
    render();
  },
  reset() {
    clearTimeout(resetTimer);
    if (!resetArmed) {
      // Первое касание: просим подтвердить. Если второго не будет — кнопка вернётся.
      resetArmed = true;
      resetTimer = setTimeout(disarmReset, RESET_CONFIRM_MS);
      renderKeepScroll();
      return;
    }
    resetArmed = false;
    state.progress = EMPTY_PROGRESS;
    saveProgress();
    renderKeepScroll();
  },
};

// Возвращает кнопке «Сбросить» обычный вид, если подтверждения не было.
function disarmReset() {
  clearTimeout(resetTimer);
  if (!resetArmed) return;
  resetArmed = false;
  if (state.screen === "lesson") renderKeepScroll();
}

// Один обработчик на всю страницу: смотрим, по какой кнопке нажали.
app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled || !actions[button.dataset.action]) return;
  // Любая другая кнопка отменяет ожидание «Точно сбросить?».
  if (button.dataset.action !== "reset") {
    clearTimeout(resetTimer);
    resetArmed = false;
  }
  actions[button.dataset.action](button);
});

// Фильтр «Прогресс».
app.addEventListener("change", (event) => {
  if (event.target.dataset.change !== "filter") return;
  const value = event.target.value;
  if (!FILTERS.some((f) => f.value === value)) return;
  state.filter = value;
  renderKeepScroll();
});


/* ---------- 7. Запуск ---------- */

document.documentElement.lang = "ru";

function start(saved) {
  if (started) return;
  started = true;
  // Если страницу обновили, пока ученик занимался, возвращаем его на то же место.
  if (saved && CHARS[saved.index] && SCREENS.includes(saved.screen)) {
    state.index = saved.index;
    state.step = Math.min(Math.max(Number(saved.step) || 0, 0), LAST_STEP);
    state.screen = saved.screen;
    state.tab = saved.tab === "review" ? "review" : "lessons";
  }
  render();
}

// На опубликованной странице сервис может обновить её «на лету».
// Тогда он передаёт, где остановился ученик; в обычном браузере этого объекта нет.
const hot = window.claude && window.claude.hot;
if (hot && hot.snapshot) {
  hot.snapshot(() => ({ screen: state.screen, index: state.index, step: state.step, tab: state.tab }));
}
if (hot && hot.ready) {
  hot.ready(start);
  setTimeout(start, 1500);   // запасной запуск, если сервис не ответил
} else {
  start(hot && hot.data);
}
