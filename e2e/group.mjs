// Прогон раздела «Группа»: хаб → новость → задача с чек-листом → опрос → контакты → ДР → аноним → лента.
import { BASE, launch, login } from "./lib.mjs";

const { browser, page, shot } = await launch();
await login(page);

await page.goto(`${BASE}/group`, { waitUntil: "networkidle" });
await shot("40-group-hub");

// Новость
await page.goto(`${BASE}/group/news/new`, { waitUntil: "networkidle" });
await page.fill('input[placeholder^="Пары в пятницу"]', "Пары в пятницу отменены");
await page.fill("textarea", "Учебный отдел прислал: 5 сентября занятий нет. Подробности тут: https://vk.com/m41o25");
await page.getByRole("button", { name: /Закрепить сверху/ }).click();
await page.getByRole("button", { name: "Опубликовать" }).click();
await page.waitForURL("**/group/news", { timeout: 20000 });
await page.waitForLoadState("networkidle");
await page.locator("button:has-text('🔥')").first().click();
await page.waitForTimeout(800);
await shot("41-news");

// Задача
await page.goto(`${BASE}/group/tasks/new`, { waitUntil: "networkidle" });
await page.fill('input[placeholder^="Сдать 500"]', "Сдать 500 ₽ на подарок Ирине Ивановне");
await page.fill("textarea", "Перевод Максиму по номеру, до пятницы");
await page.fill('input[type="date"]', "2026-09-11");
await page.getByRole("button", { name: "Создать" }).click();
await page.waitForURL(/\/group\/tasks\/[0-9a-f-]{36}$/, { timeout: 20000 });
await page.waitForLoadState("networkidle");
// Отмечаем троих
for (let i = 0; i < 3; i++) {
  await page.locator("ul li button").nth(i).click();
  await page.waitForTimeout(500);
}
await page.waitForTimeout(800);
await shot("42-task-detail");
await page.goto(`${BASE}/group/tasks`, { waitUntil: "networkidle" });
await shot("43-tasks");

// Опрос
await page.goto(`${BASE}/group/polls/new`, { waitUntil: "networkidle" });
await page.fill('input[placeholder^="Переносим пару"]', "Куда идём после сессии?");
await page.fill('input[placeholder="Вариант 1"]', "Боулинг");
await page.fill('input[placeholder="Вариант 2"]', "Кафе");
await page.getByRole("button", { name: /Ещё вариант/ }).click();
await page.fill('input[placeholder="Вариант 3"]', "Никуда, спать");
await page.getByRole("button", { name: "Создать опрос" }).click();
await page.waitForURL("**/group/polls", { timeout: 20000 });
await page.waitForLoadState("networkidle");
await page.locator("li button:has-text('Кафе')").first().click();
await page.waitForTimeout(1000);
await shot("44-polls");

// Контакт
await page.goto(`${BASE}/group/contacts/new`, { waitUntil: "networkidle" });
await page.fill('input[name="name"]', "Иванова Ирина Ивановна");
await page.fill('input[name="roleOrSubject"]', "Математический анализ");
await page.fill('input[name="email"]', "ivanova@ranepa.ru");
await page.fill('textarea[name="note"]', "Консультации: вт 14:00, каб. 305");
await page.getByRole("button", { name: "Добавить" }).click();
await page.waitForURL("**/group/contacts", { timeout: 20000 });
await page.waitForLoadState("networkidle");
await shot("45-contacts");

await page.goto(`${BASE}/group/birthdays`, { waitUntil: "networkidle" });
await shot("46-birthdays");

// Аноним
await page.goto(`${BASE}/group/questions`, { waitUntil: "networkidle" });
await page.fill("textarea", "Когда будет пересдача по микроэкономике? Никто не знает");
await page.getByRole("button", { name: /Спросить/ }).click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Ответить" }).first().click();
await page.fill('textarea[placeholder="Ответ увидят все"]', "Пересдача 18 сентября, 10:00, ауд. 305.");
await page.getByRole("button", { name: "Ответить" }).first().click();
await page.waitForTimeout(1500);
await shot("47-questions");

await page.goto(`${BASE}/group/feed`, { waitUntil: "networkidle" });
await shot("48-feed");
await page.goto(`${BASE}/group`, { waitUntil: "networkidle" });
await shot("49-group-hub-after");

await browser.close();
