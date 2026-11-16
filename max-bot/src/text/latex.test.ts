import assert from "node:assert/strict";
import { test } from "node:test";
import { convertMath, latexToUnicode } from "./latex.js";

const L = latexToUnicode;

test("дроби, корни, степени", () => {
  assert.equal(L("\\frac{1}{2}"), "1/2");
  assert.equal(L("\\frac{a+b}{2}"), "(a+b)/2");
  assert.equal(L("\\dfrac{x^2 - 1}{x + 1}"), "(x² - 1)/(x + 1)");
  assert.equal(L("\\sqrt{2}"), "√2");
  assert.equal(L("\\sqrt{x+1}"), "√(x+1)");
  assert.equal(L("\\sqrt[3]{8}"), "∛8");
  assert.equal(L("\\sqrt[n]{a}"), "ⁿ√a");
  assert.equal(L("x^2 + y^{2} = r^2"), "x² + y² = r²");
  assert.equal(L("e^{-x^2}"), "e⁻ˣ²");
  assert.equal(L("a^{n+1}"), "aⁿ⁺¹");
  assert.equal(L("2^{10}"), "2¹⁰");
  assert.equal(L("x^{1/2}"), "x^(1/2)");
  assert.equal(L("e^{\\frac{1}{2}}"), "e^(1/2)");
  assert.equal(L("A^T"), "Aᵀ");
  assert.equal(L("A^{-1}"), "A⁻¹");
});

test("индексы", () => {
  assert.equal(L("x_1 + x_2"), "x₁ + x₂");
  assert.equal(L("a_{ij}"), "aᵢⱼ");
  assert.equal(L("x_{max}"), "xₘₐₓ");
  assert.equal(L("Q_d"), "Q_d");
  assert.equal(L("P_{eq}"), "P_(eq)");
});

test("греческие, операции, отношения", () => {
  assert.equal(L("\\alpha + \\beta \\cdot \\gamma"), "α + β · γ");
  assert.equal(L("a \\times b \\div c"), "a × b ÷ c");
  assert.equal(L("x \\leq 5, y \\geq 0, z \\neq 1"), "x ≤ 5, y ≥ 0, z ≠ 1");
  assert.equal(L("\\pi \\approx 3.14"), "π ≈ 3.14");
  assert.equal(L("x \\in \\mathbb{R}"), "x ∈ ℝ");
  assert.equal(L("A \\cup B \\cap C"), "A ∪ B ∩ C");
  assert.equal(L("\\Delta P = 5\\%"), "ΔP = 5%");
  assert.equal(L("90^\\circ"), "90°");
  assert.equal(L("90^{\\circ}"), "90°");
  assert.equal(L("x \\to \\infty"), "x → ∞");
  assert.equal(L("a \\not= b"), "a ≠ b");
});

test("функции и большие операторы", () => {
  assert.equal(L("\\sin x + \\cos(x)"), "sin x + cos(x)");
  assert.equal(L("\\log_2 8 = 3"), "log₂ 8 = 3");
  assert.equal(L("\\ln{x}"), "ln x");
  assert.equal(L("\\lim_{x \\to \\infty} \\frac{1}{x} = 0"), "lim(x→∞) 1/x = 0");
  assert.equal(L("\\sum_{i=1}^{n} x_i"), "∑ᵢ₌₁ⁿ xᵢ");
  assert.equal(L("\\int_0^1 x\\,dx"), "∫₀¹ x dx");
  assert.equal(L("\\sum_{k=0}^{\\infty} a_k"), "∑(k=0…∞) aₖ");
  assert.equal(L("\\max_{x} f(x)"), "maxₓ f(x)");
});

test("текст, шрифты, скобки, акценты", () => {
  assert.equal(L("\\text{Выручка} = P \\cdot Q"), "Выручка = P · Q");
  assert.equal(L("\\mathrm{TR} = 100"), "TR = 100");
  assert.equal(L("\\left( \\frac{a}{b} \\right)^2"), "( a/b )²");
  assert.equal(L("\\left| x \\right|"), "| x |");
  assert.equal(L("\\left. f \\right|_{0}^{1}"), "f |₀¹");
  assert.equal(L("\\bar{x}"), "x̄");
  assert.equal(L("\\overline{AB}"), "A̅B̅");
  assert.equal(L("\\vec{v}"), "v⃗");
  assert.equal(L("\\binom{n}{k}"), "C(n, k)");
  assert.equal(L("a \\pmod{7}"), "a (mod 7)");
  assert.equal(L("\\boxed{42}"), "42");
});

test("окружения", () => {
  assert.equal(
    L("f(x) = \\begin{cases} x^2, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}"),
    "f(x) = { x², x ≥ 0; -x, x < 0 }",
  );
  assert.equal(L("\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}"), "(1, 2; 3, 4)");
  assert.equal(L("\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc"), "|a, b; c, d| = ad - bc");
  assert.equal(L("\\begin{aligned} y &= 2x + 1 \\\\ &= 7 \\end{aligned}"), "y = 2x + 1\n= 7");
});

test("convertMath: разделители и защита кода", () => {
  assert.equal(convertMath("Ответ: $x = \\frac{1}{2}$."), "Ответ: x = 1/2.");
  assert.equal(convertMath("Ответ: \\(x^2\\)"), "Ответ: x²");
  assert.equal(convertMath("Формула:\n$$E = mc^2$$\nГотово"), "Формула:\n\nE = mc²\n\nГотово");
  assert.equal(convertMath("Формула: \\[ a^2 + b^2 = c^2 \\] — теорема"), "Формула: \na² + b² = c²\n — теорема");
  assert.equal(convertMath("Цена $5 и $10 за штуку"), "Цена $5 и $10 за штуку");
  assert.equal(convertMath("от $10$ до $20$ рублей"), "от 10 до 20 рублей");
  assert.equal(convertMath("код `x^2 \\frac{a}{b}` не трогаем"), "код `x^2 \\frac{a}{b}` не трогаем");
  assert.equal(convertMath("```\nprint(a_b ** 2)\n```"), "```\nprint(a_b ** 2)\n```");
});

test("convertMath: голые команды и степени в обычном тексте", () => {
  assert.equal(convertMath("Получаем \\frac{3}{4} \\cdot 8 = 6"), "Получаем 3/4 · 8 = 6");
  assert.equal(convertMath("Площадь S = a^2, объём V = a^3"), "Площадь S = a², объём V = a³");
  assert.equal(convertMath("Коэффициенты x_1 и x_2"), "Коэффициенты x₁ и x₂");
  assert.equal(convertMath("переменная my_var и x_max"), "переменная my_var и x_max");
  assert.equal(convertMath("при \\alpha \\leq 0.05 гипотезу отвергаем"), "при α ≤ 0.05 гипотезу отвергаем");
  assert.equal(convertMath("2^10 = 1024"), "2¹⁰ = 1024");
  assert.equal(convertMath("\\sqrt{16} = 4"), "√16 = 4");
});

test("незнакомые команды не ломают текст", () => {
  assert.equal(L("\\foo{x}"), "foox");
  assert.equal(convertMath("обычный текст без формул"), "обычный текст без формул");
  assert.equal(convertMath("путь C:\\Users\\Max"), "путь C:\\Users\\Max");
});

test("регрессия: ссылки и идентификаторы не превращаются в индексы", () => {
  assert.equal(convertMath("[файл](https://example.com/doc_2.pdf) и var_1"), "[файл](https://example.com/doc_2.pdf) и var_1");
  assert.equal(convertMath("см. https://site.ru/a_b/x^2?q=1_2 потом x_1"), "см. https://site.ru/a_b/x^2?q=1_2 потом x₁");
  assert.equal(convertMath("snake_case_2 и my^var"), "snake_case_2 и my^var");
});

test("регрессия: \\left…\\right с \\rightarrow внутри", () => {
  assert.equal(convertMath("Предел \\lim \\left( x \\rightarrow 0 \\right) равен"), "Предел lim ( x → 0 ) равен");
});
