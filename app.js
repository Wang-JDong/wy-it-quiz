const DATA_URL = './data/questions.json';
const STORE_KEY = 'wy-it-quiz:v1';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let payload = { meta: { units: [], total: 0 }, questions: [] };
let store = loadStore();
let selectedUnits = new Set();
let selectedType = '全部';
let activePool = [];
let currentIndex = 0;
let sessionAnswers = {};

const els = {
  home: $('#homeScreen'),
  quiz: $('#quizScreen'),
  unitGrid: $('#unitGrid'),
  totalQuestions: $('#totalQuestions'),
  doneCount: $('#doneCount'),
  wrongCount: $('#wrongCount'),
  toggleAllUnits: $('#toggleAllUnits'),
  typeFilter: $('#typeFilter'),
  randomSize: $('#randomSize'),
  backBtn: $('#backBtn'),
  starBtn: $('#starBtn'),
  quizCounter: $('#quizCounter'),
  progressBar: $('#progressBar'),
  questionUnit: $('#questionUnit'),
  questionType: $('#questionType'),
  questionStem: $('#questionStem'),
  choiceList: $('#choiceList'),
  fillForm: $('#fillForm'),
  fillInput: $('#fillInput'),
  answerPanel: $('#answerPanel'),
  prevBtn: $('#prevBtn'),
  nextBtn: $('#nextBtn'),
  toast: $('#toast'),
  resetStatsBtn: $('#resetStatsBtn')
};

init();

async function init() {
  try {
    const response = await fetch(DATA_URL);
    payload = await response.json();
    selectedUnits = new Set(payload.meta.units.map((unit) => unit.name));
    bindEvents();
    renderHome();
    await registerServiceWorker();
  } catch (error) {
    showToast('题库数据读取失败，请检查 data/questions.json');
    console.error(error);
  }
}

function bindEvents() {
  els.toggleAllUnits.addEventListener('click', toggleAllUnits);
  els.typeFilter.addEventListener('click', handleTypeFilter);
  els.backBtn.addEventListener('click', showHome);
  els.prevBtn.addEventListener('click', () => moveQuestion(-1));
  els.nextBtn.addEventListener('click', () => moveQuestion(1));
  els.starBtn.addEventListener('click', toggleStar);
  els.fillForm.addEventListener('submit', handleFillSubmit);
  els.resetStatsBtn.addEventListener('click', resetStats);

  $$('.mode-card').forEach((button) => {
    button.addEventListener('click', () => startQuiz(button.dataset.start));
  });
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return createEmptyStore();
    return { ...createEmptyStore(), ...JSON.parse(raw) };
  } catch {
    return createEmptyStore();
  }
}

function createEmptyStore() {
  return {
    history: {},
    wrongIds: [],
    starredIds: []
  };
}

function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function renderHome() {
  els.totalQuestions.textContent = payload.meta.total;
  els.doneCount.textContent = Object.keys(store.history).length;
  els.wrongCount.textContent = store.wrongIds.length;
  els.unitGrid.innerHTML = payload.meta.units.map(unitTemplate).join('');
  els.unitGrid.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) selectedUnits.add(input.value);
      else selectedUnits.delete(input.value);
      syncToggleText();
    });
  });
  syncToggleText();
}

function unitTemplate(unit) {
  const checked = selectedUnits.has(unit.name) ? 'checked' : '';
  const typeLine = Object.entries(unit.types)
    .map(([type, count]) => `${type.replace('题', '')}${count}`)
    .join(' · ');
  return `
    <label class="unit-card">
      <input type="checkbox" value="${escapeHtml(unit.name)}" ${checked} />
      <span>
        <strong>${escapeHtml(unit.name)}</strong>
        <span>${escapeHtml(typeLine)}</span>
      </span>
      <em>${unit.count}</em>
    </label>
  `;
}

function handleTypeFilter(event) {
  const button = event.target.closest('button[data-type]');
  if (!button) return;
  selectedType = button.dataset.type;
  els.typeFilter.querySelectorAll('button').forEach((item) => {
    item.classList.toggle('is-active', item === button);
  });
}

function toggleAllUnits() {
  if (selectedUnits.size === payload.meta.units.length) selectedUnits.clear();
  else selectedUnits = new Set(payload.meta.units.map((unit) => unit.name));
  renderHome();
}

function syncToggleText() {
  els.toggleAllUnits.textContent = selectedUnits.size === payload.meta.units.length ? '清空' : '全选';
}

function getFilteredQuestions() {
  return payload.questions.filter((question) => {
    const unitMatch = selectedUnits.has(question.unit);
    const typeMatch = selectedType === '全部' || question.type === selectedType;
    return unitMatch && typeMatch;
  });
}

function startQuiz(mode) {
  let pool = getFilteredQuestions();
  if (!pool.length) {
    showToast('先选择至少一个章节');
    return;
  }

  if (mode === 'wrong') {
    const ids = new Set(store.wrongIds);
    pool = pool.filter((question) => ids.has(question.id));
  }

  if (mode === 'starred') {
    const ids = new Set(store.starredIds);
    pool = pool.filter((question) => ids.has(question.id));
  }

  if (!pool.length) {
    showToast(mode === 'wrong' ? '当前没有错题' : '当前没有收藏题');
    return;
  }

  if (mode === 'random') {
    pool = shuffle(pool);
    const size = els.randomSize.value;
    if (size !== 'all') pool = pool.slice(0, Number(size));
  } else if (mode === 'chapterRandom') {
    pool = shuffleWithinUnits(pool);
  }

  activePool = pool;
  currentIndex = 0;
  sessionAnswers = {};
  els.home.classList.remove('is-active');
  els.quiz.classList.add('is-active');
  renderQuestion();
}

function renderQuestion() {
  const question = activePool[currentIndex];
  const done = sessionAnswers[question.id];
  const isStarred = store.starredIds.includes(question.id);

  els.quizCounter.textContent = `${currentIndex + 1} / ${activePool.length}`;
  els.progressBar.style.width = `${((currentIndex + 1) / activePool.length) * 100}%`;
  els.questionUnit.textContent = `${question.unit} · 第 ${question.number} 题`;
  els.questionType.textContent = question.type;
  els.questionStem.textContent = question.stem;
  els.starBtn.textContent = isStarred ? '★' : '☆';
  els.starBtn.setAttribute('aria-pressed', String(isStarred));
  els.choiceList.innerHTML = '';
  els.answerPanel.innerHTML = '';
  els.answerPanel.classList.remove('is-active');
  els.fillForm.classList.toggle('is-active', question.type === '填空题');
  els.fillInput.value = '';
  els.fillInput.disabled = false;
  els.fillForm.querySelector('button').disabled = false;
  els.prevBtn.disabled = currentIndex === 0;
  els.nextBtn.textContent = currentIndex === activePool.length - 1 ? '完成' : '下一题';

  if (question.type === '填空题') {
    if (done) {
      els.fillInput.value = done.lastAnswer === '未填写' ? '' : done.lastAnswer;
      els.fillInput.disabled = true;
      els.fillForm.querySelector('button').disabled = true;
      showAnswer(question, done.correct, done.lastAnswer);
    }
    return;
  }

  els.choiceList.innerHTML = question.choices
    .map((choice) => choiceTemplate(choice, done, question.answer))
    .join('');
  els.choiceList.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => submitChoice(button.dataset.choice));
  });

  if (done) {
    els.choiceList.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    showAnswer(question, done.correct, done.lastAnswer);
  }
}

function choiceTemplate(choice, done, answer) {
  let className = 'choice-button';
  if (done && choice.key === answer) className += ' is-correct';
  if (done && choice.key === done.lastAnswer && choice.key !== answer) className += ' is-wrong';
  return `
    <button class="${className}" data-choice="${escapeHtml(choice.key)}" type="button">
      <span class="choice-key">${escapeHtml(choice.key)}</span>
      <span>${escapeHtml(choice.text)}</span>
    </button>
  `;
}

function submitChoice(choiceKey) {
  const question = activePool[currentIndex];
  const correct = choiceKey === question.answer;
  recordAnswer(question, choiceKey, correct);
  renderQuestion();
}

function handleFillSubmit(event) {
  event.preventDefault();
  const question = activePool[currentIndex];
  const userAnswer = els.fillInput.value.trim();
  const correct = normalizeFill(userAnswer) === normalizeFill(question.answerText);
  recordAnswer(question, userAnswer || '未填写', correct);
  showAnswer(question, correct, userAnswer || '未填写', !correct);
  els.fillInput.disabled = true;
  els.fillForm.querySelector('button').disabled = true;
}

function showAnswer(question, correct, userAnswer, withSelfCheck = false) {
  const answerLine = question.type === '单选题'
    ? `${question.answer}. ${question.answerText}`
    : question.answerText;
  const verdict = correct
    ? '<strong>答对了</strong>'
    : '<strong class="bad">答错了</strong>';
  const selfCheck = withSelfCheck && question.type === '填空题'
    ? `
      <div class="self-check">
        <button type="button" data-self="right">按我答对算</button>
        <button type="button" data-self="wrong">按我答错算</button>
      </div>
    `
    : '';

  els.answerPanel.innerHTML = `
    <div>${verdict}</div>
    <div>你的答案：${escapeHtml(userAnswer)}</div>
    <div>正确答案：<strong>${escapeHtml(answerLine)}</strong></div>
    ${selfCheck}
  `;
  els.answerPanel.classList.add('is-active');
  els.answerPanel.querySelectorAll('[data-self]').forEach((button) => {
    button.addEventListener('click', () => {
      recordAnswer(question, userAnswer || '未填写', button.dataset.self === 'right', true);
      renderQuestion();
    });
  });
}

function recordAnswer(question, answer, correct, replaceLast = false) {
  const previous = store.history[question.id] || { attempts: 0, correctTimes: 0 };
  const previousSession = sessionAnswers[question.id];
  const replacing = replaceLast && previousSession;
  const oldCorrectValue = replacing && previousSession.correct ? 1 : 0;
  const attempts = previous.attempts + (replacing ? 0 : 1);
  const correctTimes = Math.max(0, previous.correctTimes - oldCorrectValue + (correct ? 1 : 0));

  sessionAnswers[question.id] = {
    correct,
    lastAnswer: answer
  };

  store.history[question.id] = {
    attempts,
    correctTimes,
    correct,
    lastAnswer: answer,
    lastAt: new Date().toISOString()
  };
  store.wrongIds = correct
    ? store.wrongIds.filter((id) => id !== question.id)
    : unique([...store.wrongIds, question.id]);
  saveStore();
  renderHomeMetricsOnly();
}

function renderHomeMetricsOnly() {
  els.doneCount.textContent = Object.keys(store.history).length;
  els.wrongCount.textContent = store.wrongIds.length;
}

function moveQuestion(direction) {
  if (direction > 0 && currentIndex === activePool.length - 1) {
    showHome();
    showToast('本组练习完成');
    return;
  }
  currentIndex = Math.min(Math.max(currentIndex + direction, 0), activePool.length - 1);
  renderQuestion();
}

function showHome() {
  els.quiz.classList.remove('is-active');
  els.home.classList.add('is-active');
  renderHome();
}

function toggleStar() {
  const question = activePool[currentIndex];
  if (!question) return;
  if (store.starredIds.includes(question.id)) {
    store.starredIds = store.starredIds.filter((id) => id !== question.id);
  } else {
    store.starredIds = unique([...store.starredIds, question.id]);
  }
  saveStore();
  renderQuestion();
}

function resetStats() {
  const ok = confirm('确定清空练习记录、错题和收藏吗？');
  if (!ok) return;
  store = createEmptyStore();
  saveStore();
  renderHome();
  showToast('记录已清空');
}

function normalizeFill(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[“”"'\s]/g, '')
    .replace(/[；;，,、。]/g, ';')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .trim();
}

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function shuffleWithinUnits(list) {
  const grouped = new Map(payload.meta.units.map((unit) => [unit.name, []]));
  list.forEach((question) => {
    if (!grouped.has(question.unit)) grouped.set(question.unit, []);
    grouped.get(question.unit).push(question);
  });
  return payload.meta.units.flatMap((unit) => shuffle(grouped.get(unit.name) || []));
}

function unique(list) {
  return Array.from(new Set(list));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let toastTimer = null;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('is-active');
  toastTimer = setTimeout(() => els.toast.classList.remove('is-active'), 1800);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}
