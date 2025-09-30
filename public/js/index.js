const form = document.getElementById("create-form");
const titleInput = document.getElementById("event-title");
const resultBox = document.getElementById("create-result");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultBox.hidden = true;

  const title = titleInput.value.trim();
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });

    if (!response.ok) {
      throw new Error("创建事件失败，请稍后再试。");
    }

    const data = await response.json();
    resultBox.innerHTML = `
      <p><strong>事件创建成功：</strong> ${data.title}</p>
      <p>邀请链接：</p>
      <p><a href="${data.link}" target="_blank" rel="noopener">${data.link}</a></p>
    `;
    resultBox.hidden = false;
    titleInput.value = "";
  } catch (error) {
    console.error(error);
    resultBox.textContent = error.message || "发生未知错误。";
    resultBox.hidden = false;
  }
});
