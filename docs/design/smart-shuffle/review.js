const options = [
  {
    file: "01-quiet-brain",
    name: "Quiet brain",
    description: "Just the outline. The label carries shuffle.",
  },
  {
    file: "02-guided-brain",
    name: "Guided brain",
    description: "A small brain with arrows around it.",
  },
  {
    file: "03-single-spark",
    name: "Single spark",
    description: "One arrow becomes a spark. More room inside.",
  },
  {
    file: "04-focus-dot",
    name: "Focus dot",
    description: "Familiar shuffle with one small marker.",
  },
];

const params = new URLSearchParams(location.search);
const requested = Number(params.get("variant"));
let selected = requested >= 1 && requested <= 4 ? Math.trunc(requested) - 1 : 0;
const themeButton = document.querySelector(".theme");
const markup = new Map();

function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeButton.textContent = dark ? "Light theme" : "Dark theme";
  themeButton.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
  params.set("theme", dark ? "dark" : "light");
}

function updateUrl() {
  history.replaceState(null, "", `?${params}`);
}

function select(index) {
  selected = index;
  document.querySelectorAll(".option-button").forEach((button, i) => {
    button.setAttribute("aria-pressed", String(i === selected));
  });
  document.querySelectorAll(".selected-icon").forEach((element) => {
    element.innerHTML = markup.get(options[selected].file);
  });
  document.querySelector("#selection").textContent =
    `${String(selected + 1).padStart(2, "0")} · ${options[selected].name}`;
  params.set("variant", String(selected + 1));
  updateUrl();
}

setTheme(params.get("theme") === "dark");
themeButton.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme !== "dark");
  updateUrl();
});

try {
  await Promise.all(
    [...options.map((option) => option.file), "reference-current", "reference-real"].map(
      async (file) => {
        const response = await fetch(`${file}.svg`);
        if (!response.ok) throw new Error(`Could not load ${file}.svg`);
        const source = await response.text();
        const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        markup.set(file, svg.outerHTML);
      },
    ),
  );

  document.querySelectorAll("[data-icon]").forEach((element) => {
    element.innerHTML = markup.get(element.dataset.icon);
  });

  document.querySelector(".options").innerHTML = options
    .map(
      (option, index) => `
    <article class="option">
      <button class="option-button" type="button" aria-pressed="false" aria-label="Select option ${index + 1}: ${option.name}">
        <span class="option-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="large-icon">${markup.get(option.file)}</span>
        <span class="option-name">${option.name}</span>
        <span class="description">${option.description}</span>
        <span class="size-row">
          ${[20, 24, 32].map((size) => `<span class="size-sample"><span class="icon" style="--size:${size}px">${markup.get(option.file)}</span><span>${size} px</span></span>`).join("")}
        </span>
      </button>
      <a class="download" href="${option.file}.svg" download>Download SVG <span aria-hidden="true">↓</span></a>
    </article>
  `,
    )
    .join("");

  document.querySelectorAll(".option-button").forEach((button, index) => {
    button.addEventListener("click", () => select(index));
  });
  document.querySelectorAll(".sample-control").forEach((button) => {
    button.addEventListener("click", () => {
      button.setAttribute("aria-checked", String(button.getAttribute("aria-checked") !== "true"));
    });
  });
  select(selected);
} catch (error) {
  document.querySelector(".options").textContent =
    `${error.message}. Serve this folder over HTTP using the command in README.md.`;
}
