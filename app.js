// Тренажёр «Прописи по уроку»: вся логика страницы.
//
// Как читать этот файл (сверху вниз):
//   1. Пять шагов и их правила
//   2. Состояние: что сейчас на экране и что уже пройдено
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


/* ---------- 2. Состояние ---------- */

const CHARS = LESSON.characters;              // иероглифы урока из lesson.js
const STORAGE_KEY = "propisi-po-uroku-v1";    // под этим именем браузер хранит прогресс
const SCREENS = ["lesson", "intro", "write", "done"];

const state = {
  screen: "lesson",         // какой экран открыт
  index: 0,                 // какой по счёту иероглиф урока
  step: 0,                  // какой шаг письма идёт
  results: loadResults(),   // что пройдено: { "好": { mistakes: [0, 1, …], peeked: false, status: "learned" } }
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
// секунды, и её почти не видно. При 0,6 черта прорисовывается около секунды,
// и видно, откуда она начинается и куда идёт.
const HIGHLIGHT_SPEED = 0.6;
const LEAD_REPEAT_MS = 3000;     // как часто повторять подсветку, пока ученик думает

// Прогресс хранится в браузере ученика. Если хранилище недоступно
// (например, приватное окно), тренажёр просто работает без памяти.
function loadResults() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && typeof saved === "object" ? saved : {};
  } catch (error) {
    return {};
  }
}
function saveResults() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.results));
  } catch (error) {
    /* без памяти тоже работаем */
  }
}


/* ---------- 3. Мелкие помощники ---------- */

const app = document.getElementById("app");
const current = () => CHARS[state.index];
const statusOf = (ch) => (state.results[ch.char] || {}).status || "";
const inLesson = (char) => CHARS.some((ch) => ch.char === char);
const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

// Делает текст безопасным для вставки в страницу.
const esc = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Читает значение цвета по имени из блока :root в index.html.
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const roleVar = (role) => (role === "sound" ? "var(--sound)" : "var(--meaning)");
const roleToken = (role) => css(role === "sound" ? "--sound" : "--meaning");

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

// Следующий по порядку иероглиф, который ещё не выучен. -1 — таких не осталось.
function nextToDo(from) {
  for (let i = from + 1; i < CHARS.length; i += 1) {
    if (statusOf(CHARS[i]) !== "learned") return i;
  }
  return -1;
}

// Разлиновка листа: крест и две диагонали.
const GRID =
  '<svg class="sheet__grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
  '<path d="M50 0V100M0 50H100M0 0L100 100M100 0L0 100"></path></svg>';

// Кружок, нарисованный «от руки».
const CIRCLE =
  '<svg class="circle" viewBox="0 0 100 100" aria-hidden="true">' +
  '<path d="M55 7C80 6 95 27 93 52 91 79 68 95 45 93 21 91 5 70 8 45 11 22 31 8 60 9"></path></svg>';

// Рисует иероглиф из данных о чертах (strokes.js).
// colorOf — необязательная функция «номер черты → цвет».
function glyph(char, colorOf) {
  const data = STROKES[char];
  if (!data) return '<span class="glyph glyph--font hanzi" lang="zh-Hans">' + esc(char) + "</span>";
  const place = HanziWriter.getScalingTransform(100, 100, 10);
  const paths = data.strokes
    .map((d, i) => '<path d="' + d + '" style="fill:' + (colorOf ? colorOf(i) : "var(--ink)") + '"></path>')
    .join("");
  return (
    '<svg class="glyph" viewBox="0 0 100 100" role="img" aria-label="' + esc(char) + '">' +
    '<g transform="' + place.transform + '">' + paths + "</g></svg>"
  );
}

// Цвет черты по тому, к какой части иероглифа она относится.
function partColors(ch) {
  return (i) => {
    const part = ch.parts.find((p) => p.strokes.includes(i));
    return part ? roleVar(part.role) : "var(--ink)";
  };
}


/* ---------- 4. Экраны ---------- */
// Каждая функция view… возвращает кусок страницы в виде текста.
// Кнопки помечены data-action="…": по этому имени раздел 6 понимает, что делать.

function topBar(backAction, backLabel) {
  return `
    <header class="top">
      <button class="link" type="button" data-action="${backAction}">‹ ${backLabel}</button>
      <span class="count">${state.index + 1} из ${CHARS.length}</span>
    </header>`;
}

// Экран урока: фразы и плитки с иероглифами.
function viewLesson() {
  const attempted = CHARS.filter((ch) => statusOf(ch)).length;
  const toReview = CHARS.filter((ch) => statusOf(ch) === "review");
  const hasLearned = CHARS.some((ch) => statusOf(ch) === "learned");
  const fresh = CHARS.findIndex((ch) => !statusOf(ch));

  // Главная кнопка зависит от того, сколько уже пройдено.
  let main;
  if (fresh !== -1) {
    main = { index: fresh, label: attempted ? "Продолжить: " + CHARS[fresh].char : "Начать" };
  } else if (toReview.length) {
    main = { index: CHARS.indexOf(toReview[0]), label: "Повторить отмеченные: " + toReview.length };
  } else {
    main = { index: 0, label: "Пройти ещё раз" };
  }

  const phrases = LESSON.phrases
    .map((p) => {
      const zh = Array.from(p.zh)
        .map((c) => (inLesson(c) ? "<mark>" + c + "</mark>" : esc(c)))
        .join("");
      return `
        <li>
          <p class="phrase__zh hanzi" lang="zh-Hans">${zh}</p>
          <p class="pinyin">${esc(p.pinyin)}</p>
          <p class="phrase__ru">${esc(p.ru)}</p>
        </li>`;
    })
    .join("");

  const tiles = CHARS.map((ch, i) => {
    const status = statusOf(ch);
    return `
      <li>
        <button class="tile" type="button" data-action="open" data-index="${i}">
          <span class="sheet">${GRID}<span class="sheet__layer">${glyph(ch.char)}</span>${status === "learned" ? CIRCLE : ""}</span>
          <span class="tile__pinyin pinyin">${esc(ch.pinyin)}</span>
          <span class="tile__ru">${esc(ch.short)}</span>
          ${status === "review" ? '<span class="tile__mark">повторить</span>' : ""}
        </button>
      </li>`;
  }).join("");

  return `
    <main class="body body--scroll">
      <header>
        <p class="eyebrow">Урок ${LESSON.number}</p>
        <h1 class="title">${esc(LESSON.title)}</h1>
      </header>
      <ul class="phrases">${phrases}</ul>
      <h2 class="h2">Иероглифы урока <span class="h2__count">${CHARS.length}</span></h2>
      <ul class="tiles">${tiles}</ul>
      ${hasLearned ? `<p class="legend">${CIRCLE}<span>Красный кружок — иероглиф написан по памяти без ошибок.</span></p>` : ""}
      <p class="proto-note">Это прототип: урок, фразы и подписи взяты для примера.</p>
    </main>
    <footer class="actions">
      ${attempted ? resetButton() : ""}
      <button class="btn" type="button" data-action="open" data-index="${main.index}">${main.label}</button>
    </footer>`;
}

// Кнопка «Сбросить»: первое касание только спрашивает, второе стирает прогресс.
function resetButton() {
  return resetArmed
    ? '<button class="btn btn--ghost btn--narrow btn--danger" type="button" data-action="reset">Точно сбросить?</button>'
    : '<button class="btn btn--ghost btn--narrow" type="button" data-action="reset">Сбросить</button>';
}

// Экран разбора: чтение, перевод и части иероглифа.
function viewIntro() {
  const ch = current();

  const parts = ch.parts
    .map((part) => {
      const also = part.seeAlso
        .map((item) => {
          const here = inLesson(item.c);
          return `
            <li class="also__item${here ? " also__item--lesson" : ""}">
              <span class="also__zh hanzi" lang="zh-Hans">${esc(item.c)}</span>
              <span class="also__py pinyin">${esc(item.p)}</span>
              <span class="also__ru">${esc(item.m)}${here ? ' · <span class="also__tag">в уроке</span>' : ""}</span>
            </li>`;
        })
        .join("");
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
    })
    .join("");

  return `
    ${topBar("lesson", "Урок")}
    <main class="body body--scroll">
      <section class="char-head">
        <div class="sheet">${GRID}<div class="sheet__layer" id="introGlyph">${glyph(ch.char, partColors(ch))}</div></div>
        <div class="char-head__text">
          <p class="pinyin pinyin--xl">${esc(ch.pinyin)}</p>
          <p class="meaning">${esc(ch.meaning)}</p>
          <p class="example"><span class="hanzi" lang="zh-Hans">${esc(ch.word.zh)}</span> <span class="pinyin">${esc(ch.word.pinyin)}</span> — ${esc(ch.word.ru)}</p>
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
      <button class="btn btn--ghost" type="button" data-action="animate">Порядок черт</button>
      <button class="btn" type="button" data-action="write">Писать</button>
    </footer>`;
}

// Экран письма: подсказка-задание, полоска шагов, лист и две кнопки.
function viewWrite() {
  const ch = current();
  const step = STEPS[state.step];
  const bar = STEPS.map((s, i) => `<li class="${i < state.step ? "is-done" : i === state.step ? "is-now" : ""}"></li>`).join("");

  return `
    ${topBar("intro", "Разбор")}
    <main class="body body--write">
      <p class="prompt">
        <span class="pinyin pinyin--lg">${esc(ch.pinyin)}</span>
        <span class="prompt__ru">${esc(ch.meaning)}</span>
      </p>
      <div class="steps">
        <ol class="steps__bar" aria-hidden="true">${bar}</ol>
        <p class="steps__name">Шаг ${state.step + 1} из ${STEPS.length} · ${step.name}</p>
        <p class="steps__rule">${step.rule}</p>
      </div>
      <div class="stage" id="stage">
        <div class="sheet" id="sheet">${GRID}<div class="sheet__layer" id="writerTarget"></div></div>
        <p class="status" id="status" aria-live="polite"></p>
      </div>
    </main>
    <footer class="actions">
      <button class="btn btn--ghost" type="button" data-action="hint">${state.step === LAST_STEP ? "Подсмотреть" : "Подсказка"}</button>
      <button class="btn btn--ghost" type="button" data-action="restart">Заново</button>
    </footer>`;
}

// Экран итога по одному иероглифу.
function viewDone() {
  const ch = current();
  const result = state.results[ch.char];
  const clean = result.status === "learned";
  const next = nextToDo(state.index);

  let verdict = "Написано по памяти без ошибок";
  if (!clean) {
    const n = result.mistakes[LAST_STEP] || 0;
    const how = [];
    if (n) how.push(mistakesText(n));
    if (result.peeked) how.push("с подсказкой");
    verdict = "По памяти: " + how.join(", ") + ". Иероглиф отмечен на повторение.";
  }

  const report = STEPS.map((s, i) => `<li><span>${s.name}</span><span>${mistakesText(result.mistakes[i])}</span></li>`).join("");

  return `
    ${topBar("lesson", "Урок")}
    <main class="body body--scroll body--result">
      <div class="sheet sheet--result">${GRID}<div class="sheet__layer">${glyph(ch.char, partColors(ch))}</div>${clean ? CIRCLE : ""}</div>
      <p class="pinyin pinyin--xl">${esc(ch.pinyin)}</p>
      <p class="meaning">${esc(ch.meaning)}</p>
      <p class="verdict verdict--${clean ? "ok" : "review"}">${verdict}</p>
      <ol class="report">${report}</ol>
    </main>
    <footer class="actions">
      <button class="btn btn--ghost" type="button" data-action="again">Ещё раз по памяти</button>
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
  if (state.screen === "done" && !state.results[current().char]) state.screen = "intro";

  const views = { lesson: viewLesson, intro: viewIntro, write: viewWrite, done: viewDone };
  app.innerHTML = views[state.screen]();
  if (state.screen === "write") mountWrite();
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
  const ink = css("--ink");
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
    highlightColor: css("--rule"),
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

// Шаг пройден: запоминаем ошибки и идём дальше.
function finishStep(mistakes) {
  const ch = current();
  const result = state.results[ch.char] || { mistakes: [], peeked: false, status: "" };
  state.results[ch.char] = result;
  result.mistakes[state.step] = mistakes;
  attempt.finished = true;
  stopLead();

  const last = state.step === LAST_STEP;
  if (last) {
    result.peeked = attempt.peeked;
    result.status = mistakes === 0 && !attempt.peeked ? "learned" : "review";
  }
  saveResults();

  say(mistakes ? "Шаг пройден: " + mistakesText(mistakes) : "Шаг пройден без ошибок", "ok");
  advanceTimer = setTimeout(() => {
    if (last) state.screen = "done";
    else state.step += 1;
    render();
  }, 1100);
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

const actions = {
  open(button) {
    state.index = Number(button.dataset.index);
    state.step = 0;
    state.screen = "intro";
    render();
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
    if (i === -1) {
      state.screen = "lesson";
    } else {
      state.index = i;
      state.step = 0;
      state.screen = "intro";
    }
    render();
  },
  reset() {
    clearTimeout(resetTimer);
    if (!resetArmed) {
      // Первое касание: просим подтвердить. Если второго не будет — кнопка вернётся.
      resetArmed = true;
      resetTimer = setTimeout(disarmReset, RESET_CONFIRM_MS);
      render();
      return;
    }
    resetArmed = false;
    state.results = {};
    saveResults();
    render();
  },
};

// Возвращает кнопке «Сбросить» обычный вид, если подтверждения не было.
function disarmReset() {
  clearTimeout(resetTimer);
  if (!resetArmed) return;
  resetArmed = false;
  if (state.screen === "lesson") render();
}

// Один обработчик на всю страницу: смотрим, по какой кнопке нажали.
app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || !actions[button.dataset.action]) return;
  // Любая другая кнопка отменяет ожидание «Точно сбросить?».
  if (button.dataset.action !== "reset") {
    clearTimeout(resetTimer);
    resetArmed = false;
  }
  actions[button.dataset.action](button);
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
  }
  render();
}

// Смена светлой и тёмной темы: перерисовываем экран, чтобы лист взял новые цвета.
function onThemeChange() {
  if (started) render();
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onThemeChange);
new MutationObserver(onThemeChange).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});

// На опубликованной странице сервис может обновить её «на лету».
// Тогда он передаёт, где остановился ученик; в обычном браузере этого объекта нет.
const hot = window.claude && window.claude.hot;
if (hot && hot.snapshot) {
  hot.snapshot(() => ({ screen: state.screen, index: state.index, step: state.step }));
}
if (hot && hot.ready) {
  hot.ready(start);
  setTimeout(start, 1500);   // запасной запуск, если сервис не ответил
} else {
  start(hot && hot.data);
}
