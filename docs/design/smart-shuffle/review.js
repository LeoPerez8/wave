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
  {
    file: "05-tuned-mix",
    name: "Tuned mix",
    description: "Two adjustable lanes suggest a balanced mix.",
  },
  {
    file: "06-flow-loop",
    name: "Flow loop",
    description: "An open loop carries the mix forward.",
  },
  {
    file: "07-crossed-mix",
    name: "Crossed mix",
    description: "Two tuning points feed paths that swap order.",
  },
  {
    file: "08-mix-junction",
    name: "Mix junction",
    description: "One tuning point sits where the paths cross.",
  },
];

const params = new URLSearchParams(location.search);
const requested = Number(params.get("variant"));
let selected = requested >= 1 && requested <= options.length ? Math.trunc(requested) - 1 : 0;
let rotation = params.get("rotation") === "0" ? 0 : 45;
const themeButton = document.querySelector(".theme");
const markup = new Map();

function sparkFile(angle) {
  return angle === 0 ? "03-single-spark-original" : "03-single-spark";
}

function iconMarkup(file) {
  return markup.get(file === "03-single-spark" ? sparkFile(rotation) : file);
}

function sizeSamples(svg) {
  return [20, 24, 32]
    .map(
      (size) =>
        `<span class="size-sample"><span class="icon" style="--size:${size}px">${svg}</span><span>${size} px</span></span>`,
    )
    .join("");
}

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
  document.querySelectorAll(".options .option-button").forEach((button, i) => {
    button.setAttribute("aria-pressed", String(i === selected));
  });
  document.querySelectorAll(".selected-icon").forEach((element) => {
    element.innerHTML = iconMarkup(options[selected].file);
  });
  document.querySelector("#selection").textContent =
    `${String(selected + 1).padStart(2, "0")} · ${options[selected].name}${selected === 2 ? ` · ${rotation}°` : ""}`;
  params.set("variant", String(selected + 1));
  updateUrl();
}

function selectRotation(angle) {
  rotation = angle;
  document.querySelectorAll(".spark-button").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.rotation) === angle));
  });
  document
    .querySelectorAll(".option:nth-child(3) .large-icon, .option:nth-child(3) .size-row .icon")
    .forEach((element) => {
      element.innerHTML = iconMarkup("03-single-spark");
    });
  document.querySelector(".option:nth-child(3) .download").href = `${sparkFile(angle)}.svg`;
  params.set("rotation", String(angle));
  select(2);
}

setTheme(params.get("theme") === "dark");
themeButton.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme !== "dark");
  updateUrl();
});

try {
  await Promise.all(
    [
      ...options.map((option) => option.file),
      "03-single-spark-original",
      "reference-current",
      "reference-real",
    ].map(async (file) => {
      const response = await fetch(`${file}.svg`);
      if (!response.ok) throw new Error(`Could not load ${file}.svg`);
      const source = await response.text();
      const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      markup.set(file, svg.outerHTML);
    }),
  );

  document.querySelectorAll("[data-icon]").forEach((element) => {
    element.innerHTML = markup.get(element.dataset.icon);
  });

  document.querySelector(".spark-options").innerHTML = [0, 45]
    .map(
      (angle) => `
    <button class="option-button spark-button" type="button" data-rotation="${angle}" aria-pressed="${angle === rotation}" aria-label="Preview spark at ${angle} degrees">
      <span class="option-number">${angle === 0 ? "Original" : "Rotated"} · ${angle}°</span>
      <span class="large-icon">${markup.get(sparkFile(angle))}</span>
      <span class="size-row">${sizeSamples(markup.get(sparkFile(angle)))}</span>
    </button>
  `,
    )
    .join("");
  document.querySelectorAll(".spark-button").forEach((button) => {
    button.addEventListener("click", () => selectRotation(Number(button.dataset.rotation)));
  });

  document.querySelector(".options").innerHTML = options
    .map(
      (option, index) => `
    <article class="option">
      <button class="option-button" type="button" aria-pressed="false" aria-label="Select option ${index + 1}: ${option.name}">
        <span class="option-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="large-icon">${iconMarkup(option.file)}</span>
        <span class="option-name">${option.name}</span>
        <span class="description">${option.description}</span>
        <span class="size-row">
          ${sizeSamples(iconMarkup(option.file))}
        </span>
      </button>
      <a class="download" href="${option.file === "03-single-spark" ? sparkFile(rotation) : option.file}.svg" download>Download SVG <span aria-hidden="true">↓</span></a>
    </article>
  `,
    )
    .join("");

  document.querySelectorAll(".options .option-button").forEach((button, index) => {
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
