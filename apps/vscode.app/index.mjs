const fs = anura.fs;
const root = "/workspace";
const tree = document.getElementById("tree");
const status = document.getElementById("status-right");
const editorHost = document.getElementById("editor");
const tab = document.getElementById("tab");
const enc = new TextEncoder();
let editor;
let currentPath = null;
let currentModel = null;

window.MonacoEnvironment = {
  getWorkerUrl: () => "data:text/javascript;charset=utf-8," + encodeURIComponent(
    "self.MonacoEnvironment={baseUrl:'/libs/monaco-editor/min/'};importScripts('/libs/monaco-editor/min/vs/base/worker/workerMain.js');"
  )
};
window.require.config({ paths: { vs: "/libs/monaco-editor/min/vs" } });
const monaco = await new Promise((resolve, reject) => {
  window.require(["vs/editor/editor.main"], () => resolve(window.monaco), reject);
});

editorHost.innerHTML = "";
editor = monaco.editor.create(editorHost, {
  value: "",
  language: "javascript",
  theme: "vs-dark",
  automaticLayout: true,
  fontSize: 13,
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
  roundedSelection: false,
  wordWrap: "on"
});

const languageFor = (path) => {
  const ext = path.split(".").pop().toLowerCase();
  return ({js:"javascript",mjs:"javascript",ts:"typescript",tsx:"typescript",jsx:"javascript",html:"html",css:"css",json:"json",md:"markdown",py:"python",rs:"rust",sh:"shell",yml:"yaml",yaml:"yaml",xml:"xml",txt:"plaintext"})[ext] || "plaintext";
};

async function ensureWorkspace() {
  try { await fs.promises.mkdir(root); } catch (e) { if (e?.code !== "EEXIST") throw e; }
  try { await fs.promises.stat(root + "/hello.js"); }
  catch {
    await fs.promises.writeFile(root + "/hello.js", "// Welcome to your AnuraOS workspace\n\nconsole.log('Hello from AnuraOS!');\n");
  }
}

async function openFile(path) {
  try {
    const data = await fs.promises.readFile(path);
    const content = new TextDecoder().decode(data);
    if (currentModel) currentModel.dispose();
    currentModel = monaco.editor.createModel(content, languageFor(path));
    editor.setModel(currentModel);
    currentPath = path;
    tab.textContent = path.split("/").pop();
    document.getElementById("status-left").textContent = path;
    status.textContent = "Loaded";
    renderTree();
  } catch (error) {
    status.textContent = "Open failed: " + String(error);
  }
}

async function renderTree() {
  tree.innerHTML = "";
  const addFolder = async (path, depth) => {
    let names;
    try { names = await fs.promises.readdir(path); } catch { return; }
    names.sort((a,b) => a.localeCompare(b));
    for (const name of names.slice(0, 250)) {
      const full = path + "/" + name;
      let stat;
      try { stat = await fs.promises.stat(full); } catch { continue; }
      const button = document.createElement("button");
      button.className = "tree-item" + (full === currentPath ? " active" : "");
      button.style.paddingLeft = (12 + depth * 14) + "px";
      button.textContent = (stat.isDirectory() ? "▸  " : "   ") + name;
      button.title = full;
      button.addEventListener("click", async () => {
        if (stat.isDirectory()) {
          const nested = button.nextElementSibling;
          if (nested) nested.remove();
          else {
            const wrap = document.createElement("div");
            button.after(wrap);
            const previousTree = tree;
            const addInto = async (folder, d) => {
              const entries = await fs.promises.readdir(folder).catch(() => []);
              for (const child of entries.sort()) {
                const childPath = folder + "/" + child;
                const childStat = await fs.promises.stat(childPath).catch(() => null);
                if (!childStat) continue;
                const item = document.createElement("button");
                item.className = "tree-item";
                item.style.paddingLeft = (12 + d * 14) + "px";
                item.textContent = (childStat.isDirectory() ? "▸  " : "   ") + child;
                item.addEventListener("click", () => childStat.isDirectory() ? status.textContent = "Folder: " + childPath : openFile(childPath));
                wrap.appendChild(item);
              }
            };
            await addInto(full, depth + 1);
          }
        } else await openFile(full);
      });
      tree.appendChild(button);
    }
  };
  await addFolder(root, 0);
}

async function saveFile() {
  if (!currentPath || !editor) return;
  await fs.promises.writeFile(currentPath, enc.encode(editor.getValue()));
  status.textContent = "Saved";
  renderTree();
}

document.getElementById("save").addEventListener("click", saveFile);
document.getElementById("new").addEventListener("click", async () => {
  const name = prompt("New file name (inside /workspace):", "untitled.js");
  if (!name) return;
  const safeName = name.replace(/^\/+/, "").replaceAll("..", "");
  const path = root + "/" + safeName;
  await fs.promises.writeFile(path, "");
  await renderTree();
  await openFile(path);
});
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveFile();
  }
});

await ensureWorkspace();
await renderTree();
await openFile(root + "/hello.js");
