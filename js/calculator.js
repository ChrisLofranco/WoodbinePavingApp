/* calculator.js — job pricing + asphalt tonnage.
 *
 * Pure calc functions are exposed on window.WoodbineCalculator so they can be
 * unit-tested directly (see verification). UI wiring is in init().
 */
(function () {
  'use strict';

  // ---- Constants ----
  var HST_RATE = 0.13;                 // Ontario HST
  var ASPHALT_LB_PER_FT3 = 145;        // compacted hot-mix asphalt density
  var LB_PER_TON = 2000;               // US short ton

  // ---- Pure calculation ----

  // Sum of length*width for every area section: [{length, width}, ...]
  function totalSquareFootage(sections) {
    return sections.reduce(function (sum, s) {
      var l = toNum(s.length), w = toNum(s.width);
      return sum + l * w;
    }, 0);
  }

  // Estimated tons of asphalt for a given area + thickness (inches).
  // tons = area(ft^2) * thickness(ft) * density(lb/ft^3) / 2000
  function estimateTons(squareFootage, thicknessInches) {
    var thicknessFt = toNum(thicknessInches) / 12;
    return squareFootage * thicknessFt * ASPHALT_LB_PER_FT3 / LB_PER_TON;
  }

  // Full quote from inputs. Returns everything the UI needs.
  function quote(sections, thicknessInches, rate) {
    var sqft = totalSquareFootage(sections);
    var r = toNum(rate);
    var cash = sqft * r;             // pre-tax total (cash jobs)
    var hst = cash * HST_RATE;
    var taxed = cash + hst;          // total including HST
    var tons = estimateTons(sqft, thicknessInches);
    return { squareFootage: sqft, cash: cash, hst: hst, taxed: taxed, tons: tons };
  }

  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  // ---- Formatting ----
  var money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
  function fmtMoney(n) { return money.format(n || 0); }
  function fmtSqft(n) {
    return (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 }) + ' sq ft';
  }
  function fmtTons(n) {
    return (n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' tons';
  }

  // ---- UI ----
  var sectionsEl, thicknessEl, rateEl;
  var outSqft, outCash, outTaxed, outHst, outTons;
  var sectionCount = 0;

  function addSection(focus) {
    sectionCount += 1;
    var idx = sectionCount;
    var block = document.createElement('div');
    block.className = 'section-block';
    block.dataset.section = String(idx);
    block.innerHTML =
      '<div class="section-head">' +
        '<span class="section-title">Area ' + idx + '</span>' +
        '<button class="section-remove" type="button" title="Remove area" aria-label="Remove area">&times;</button>' +
      '</div>' +
      '<div class="field-row">' +
        '<label class="field"><span class="field-label">Length (ft)</span>' +
          '<input class="calc-input inp-length" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0" /></label>' +
        '<label class="field"><span class="field-label">Width (ft)</span>' +
          '<input class="calc-input inp-width" type="number" inputmode="decimal" min="0" step="0.1" placeholder="0" /></label>' +
      '</div>';

    block.querySelector('.section-remove').addEventListener('click', function () {
      if (sectionsEl.querySelectorAll('.section-block').length > 1) {
        block.remove();
        recalc();
      }
    });
    block.querySelectorAll('.calc-input').forEach(function (inp) {
      inp.addEventListener('input', recalc);
    });

    sectionsEl.appendChild(block);
    if (focus) block.querySelector('.inp-length').focus();
    updateRemoveButtons();
  }

  function updateRemoveButtons() {
    var blocks = sectionsEl.querySelectorAll('.section-block');
    blocks.forEach(function (b) {
      b.querySelector('.section-remove').style.visibility = blocks.length > 1 ? 'visible' : 'hidden';
    });
  }

  function readSections() {
    return Array.prototype.map.call(
      sectionsEl.querySelectorAll('.section-block'),
      function (b) {
        return {
          length: b.querySelector('.inp-length').value,
          width: b.querySelector('.inp-width').value
        };
      }
    );
  }

  function recalc() {
    var q = quote(readSections(), thicknessEl.value, rateEl.value);
    outSqft.textContent = fmtSqft(q.squareFootage);
    outCash.textContent = fmtMoney(q.cash);
    outTaxed.textContent = fmtMoney(q.taxed);
    outHst.textContent = 'incl. ' + fmtMoney(q.hst) + ' HST';
    outTons.textContent = fmtTons(q.tons);
  }

  function init() {
    sectionsEl = document.getElementById('sections');
    thicknessEl = document.getElementById('thickness');
    rateEl = document.getElementById('rate');
    outSqft = document.getElementById('out-sqft');
    outCash = document.getElementById('out-cash');
    outTaxed = document.getElementById('out-taxed');
    outHst = document.getElementById('out-hst');
    outTons = document.getElementById('out-tons');

    addSection(false);
    document.getElementById('add-section-btn').addEventListener('click', function () { addSection(true); });
    thicknessEl.addEventListener('input', recalc);
    rateEl.addEventListener('input', recalc);
    recalc();
  }

  window.WoodbineCalculator = {
    init: init,
    // exposed for tests:
    totalSquareFootage: totalSquareFootage,
    estimateTons: estimateTons,
    quote: quote
  };
})();
