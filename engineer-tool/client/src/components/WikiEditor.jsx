import React, { useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

const TOOLBAR_BTN = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 13,
  background: "transparent",
  color: "inherit",
  transition: "background 0.15s",
};

const TOOLBAR_BTN_ACTIVE = {
  ...TOOLBAR_BTN,
  background: "rgba(79,124,255,0.25)",
  borderColor: "rgba(79,124,255,0.5)",
  fontWeight: 700,
};

const SEP = (
  <div style={{ width: 1, background: "var(--border)", margin: "0 2px", alignSelf: "stretch" }} />
);

export default function WikiEditor({ value, onChange }) {
  const imgRef = useRef();
  const gifRef = useRef();

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } }),
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor) return null;

  async function insertMedia(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return alert("Файл больше 20MB");
    const b64 = await toBase64(file);
    editor.chain().focus().setImage({ src: b64, alt: file.name }).run();
  }

  function setLink() {
    const prev = editor.getAttributes("link").href || "";
    const url = window.prompt("Введи URL:", prev);
    if (url === null) return;
    if (!url) { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().setLink({ href: url.startsWith("http") ? url : `https://${url}` }).run();
  }

  function btn(active, onClick, label, title) {
    return (
      <button
        key={label}
        title={title || label}
        onMouseDown={(e) => { e.preventDefault(); onClick(); }}
        style={active ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      {/* ── Тулбар ── */}
      <div style={{
        display: "flex", gap: 4, padding: "8px 10px", flexWrap: "wrap", alignItems: "center",
        borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.03)",
      }}>
        {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), "H1", "Заголовок 1")}
        {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "H2", "Заголовок 2")}
        {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), "H3", "Заголовок 3")}
        {SEP}
        {btn(editor.isActive("bold"),   () => editor.chain().focus().toggleBold().run(),   "B", "Жирный")}
        {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "I", "Курсив")}
        {btn(editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "S̶", "Зачёркнутый")}
        {btn(editor.isActive("code"),   () => editor.chain().focus().toggleCode().run(),   "</>", "Код")}
        {SEP}
        {btn(editor.isActive("bulletList"),  () => editor.chain().focus().toggleBulletList().run(),  "• Список")}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "1. Список")}
        {btn(editor.isActive("blockquote"),  () => editor.chain().focus().toggleBlockquote().run(),  "❝ Цитата")}
        {SEP}
        {btn(editor.isActive("link"), setLink, "🔗 Ссылка")}
        <button
          title="Вставить фото или GIF"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => imgRef.current?.click()}
          style={TOOLBAR_BTN}
        >🖼️ Фото / GIF</button>
      </div>

      <input
        ref={imgRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { insertMedia(e.target.files?.[0]); e.target.value = ""; }}
      />

      {/* ── Область редактирования ── */}
      <style>{`
        .wiki-editor .tiptap { outline: none; padding: 16px; min-height: 280px; line-height: 1.7; }
        .wiki-editor .tiptap h1 { font-size: 1.6em; margin: 1em 0 0.4em; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
        .wiki-editor .tiptap h2 { font-size: 1.3em; margin: 1em 0 0.3em; }
        .wiki-editor .tiptap h3 { font-size: 1.1em; margin: 0.8em 0 0.3em; opacity: 0.85; }
        .wiki-editor .tiptap ul  { padding-left: 1.5em; list-style: disc; }
        .wiki-editor .tiptap ol  { padding-left: 1.5em; list-style: decimal; }
        .wiki-editor .tiptap li  { margin: 2px 0; }
        .wiki-editor .tiptap blockquote { border-left: 3px solid rgba(79,124,255,.5); margin: 0; padding: 4px 12px; opacity: 0.8; font-style: italic; }
        .wiki-editor .tiptap code { background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 5px; font-size: 0.88em; }
        .wiki-editor .tiptap img { max-width: 100%; border-radius: 10px; margin: 8px 0; cursor: pointer; border: 1px solid var(--border); }
        .wiki-editor .tiptap a   { color: #7b9fff; text-decoration: underline; }
        .wiki-editor .tiptap p   { margin: 0 0 0.5em; }
      `}</style>
      <div className="wiki-editor">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ── Утилита: генерация содержания и добавление id к заголовкам ──────────────
export function processArticleHTML(html) {
  if (!html || !html.trim().startsWith("<")) return { toc: [], html };

  const headings = [];
  const usedIds = {};

  const processed = html.replace(
    /<h([1-3])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_, level, attrs, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      let id = text
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9а-яёa-z\-]/gi, "")
        .slice(0, 60) || `section-${headings.length}`;

      // уникальность id
      if (usedIds[id]) { usedIds[id]++; id = `${id}-${usedIds[id]}`; }
      else usedIds[id] = 1;

      headings.push({ level: parseInt(level), text, id });
      return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
    }
  );

  return { toc: headings, html: processed };
}

// ── Компонент: отображение статьи с содержанием ─────────────────────────────
export function ArticleBody({ body }) {
  if (!body) return null;

  const isHTML = body.trim().startsWith("<");

  if (!isHTML) {
    return <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, wordBreak: "break-word" }}>{body}</div>;
  }

  const { toc, html } = processArticleHTML(body);

  return (
    <div>
      {/* Содержание */}
      {toc.length >= 2 && (
        <div style={{
          border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px",
          marginBottom: 16, background: "rgba(79,124,255,0.05)",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, opacity: 0.7, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            📋 Содержание
          </div>
          {toc.map((item, i) => (
            <div key={i} style={{ paddingLeft: (item.level - 1) * 14, marginBottom: 3 }}>
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                style={{ color: "#7b9fff", textDecoration: "none", fontSize: item.level === 1 ? 14 : 13, fontWeight: item.level === 1 ? 600 : 400 }}
              >
                {item.level === 1 ? "▸ " : item.level === 2 ? "  · " : "    – "}
                {item.text}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Тело статьи */}
      <style>{`
        .wiki-article h1 { font-size: 1.6em; margin: 1em 0 0.4em; border-bottom: 1px solid var(--border); padding-bottom: 6px; scroll-margin-top: 80px; }
        .wiki-article h2 { font-size: 1.3em; margin: 1.2em 0 0.3em; scroll-margin-top: 80px; }
        .wiki-article h3 { font-size: 1.1em; margin: 0.8em 0 0.2em; opacity: 0.85; scroll-margin-top: 80px; }
        .wiki-article ul  { padding-left: 1.5em; list-style: disc; }
        .wiki-article ol  { padding-left: 1.5em; list-style: decimal; }
        .wiki-article li  { margin: 3px 0; line-height: 1.6; }
        .wiki-article blockquote { border-left: 3px solid rgba(79,124,255,.5); margin: 8px 0; padding: 4px 14px; opacity: 0.8; font-style: italic; }
        .wiki-article code { background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 5px; font-size: 0.88em; }
        .wiki-article img { max-width: 100%; border-radius: 12px; margin: 10px 0; border: 1px solid var(--border); cursor: zoom-in; }
        .wiki-article a   { color: #7b9fff; text-decoration: underline; }
        .wiki-article p   { margin: 0 0 0.6em; line-height: 1.7; word-break: break-word; }
        .wiki-article strong { font-weight: 700; }
        .wiki-article em { font-style: italic; }
      `}</style>
      <div
        className="wiki-article"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          // Клик по картинке → лайтбокс через событие
          if (e.target.tagName === "IMG") {
            e.target.dispatchEvent(new CustomEvent("wiki-img-click", { bubbles: true, detail: { src: e.target.src } }));
          }
        }}
      />
    </div>
  );
}
