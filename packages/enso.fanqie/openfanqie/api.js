import { PATHS } from './protocol/app.js';
import { Client } from './client.js';
import { decryptChapterContent, markupToText } from './crypt/book.js';

// 搜索 tab 类型（实测 2026-11）。
export const SEARCH_TABS = {
  all: 1,      // 综合
  community: 4,
  drama: 11,   // 短剧
  comic: 8,
  audio: 2,    // 听书
  book: 3,     // 书籍
  fullText: 5,
  user: 6,
};

// 把 cell 树里所有 book_data 摊平（cell 可以嵌套 cell_data）。
function collectBooks(cells, out = []) {
  if (!Array.isArray(cells)) return out;
  for (const cell of cells) {
    if (!cell) continue;
    const books = cell.book_data || cell.bookData;
    if (Array.isArray(books)) {
      for (const b of books) out.push(normalizeBook(b));
    }
    if (Array.isArray(cell.cell_data)) collectBooks(cell.cell_data, out);
  }
  return out;
}

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// 封面 URL 带签名，只能原样请求；后缀固定是 heic（App 端原生支持）。
function coverFormat(url) {
  const m = /~[^~]*?\.(\w+)(?:\?|$)/.exec(url || '');
  return m ? m[1].toLowerCase() : '';
}

export function normalizeBook(raw = {}) {
  return {
    bookId: text(raw.book_id),
    title: text(raw.book_name || raw.original_book_name),
    author: text(raw.author),
    // 列表页的 abstract 会被截断到约 100 字，book_abstract_v2 才是完整简介。
    abstract: text(raw.book_abstract_v2) || text(raw.abstract),
    shortAbstract: text(raw.abstract),
    category: text(raw.category),
    categoryTags: text(raw.pure_category_tags),
    tags: text(raw.tags),
    wordCount: num(raw.word_number),
    score: num(raw.score),
    readCount: num(raw.read_count),
    readCountText: text(raw.read_cnt_text),
    rankScore: text(raw.rank_score),
    serialCount: num(raw.serial_count),
    contentChapterNumber: num(raw.content_chapter_number),
    lastChapterTitle: text(raw.last_chapter_title),
    lastChapterItemId: text(raw.last_chapter_item_id),
    lastPublishTime: num(raw.last_publish_time),
    firstChapterItemId: text(raw.first_chapter_item_id),
    firstChapterTitle: text(raw.first_chapter_title),
    creationStatus: text(raw.creation_status),
    // 实测：0 的书最近更新在 500 天前（完结），1 的都在 0~1 天内（连载）。
    isFinished: text(raw.creation_status) === '0',
    updateStatus: text(raw.update_status),
    isEbook: text(raw.is_ebook) === '1',
    exclusive: text(raw.exclusive) === '1',
    vipBook: text(raw.vip_book) === '1',
    ttsStatus: text(raw.tts_status),
    lengthType: text(raw.length_type),
    source: text(raw.source),
    coverUrl: text(raw.thumb_url || raw.expand_thumb_url),
    coverUrlHd: text(raw.expand_thumb_url || raw.thumb_url),
    coverFormat: coverFormat(raw.expand_thumb_url || raw.thumb_url),
    bookType: text(raw.book_type),
    gender: text(raw.gender),
    url: text(raw.url),
    raw,
  };
}

export function normalizeChapter(raw = {}, index = -1) {
  return {
    itemId: text(raw.item_id),
    title: text(raw.title).trim(),
    index,
    volumeName: text(raw.volume_name),
    wordNumber: num(raw.chapter_word_number),
    chapterType: text(raw.chapter_type),
    contentMd5: text(raw.content_md5),
    version: text(raw.version),
    isReview: raw.is_review === true,
    firstPassTime: num(raw.first_pass_time),
  };
}

export class FanqieClient extends Client {
  // 书城。tabType 0=推荐（实测），offset 为翻页偏移。
  async bookmall({ tabType = 0, offset = 0, tabIndex = 0 } = {}) {
    const data = await this.get(PATHS.bookmallTab, [
      ['tab_type', String(tabType)],
      ['offset', String(offset)],
      ['tab_index', String(tabIndex)],
      ['client_req_type', '3'],
    ]);
    const tabItems = data.tab_item || [];
    const books = collectBooks(tabItems.flatMap((t) => t.cell_data || []));
    const first = tabItems[0] || {};
    return {
      books,
      tabs: tabItems.map((t) => ({ tabType: t.tab_type, title: t.title })),
      nextOffset: num(first.next_offset),
      hasMore: first.has_more === true || first.has_more === 1,
      sessionId: text(first.session_id),
      clientTemplate: text(first.client_template),
      raw: data,
    };
  }

  // 搜索。tab 可传 SEARCH_TABS 的名字或数字。
  async search(keyword, { tab = 1, offset = 0, count = 10 } = {}) {
    if (!keyword) throw new Error('search: 缺少关键词');
    const tabType = typeof tab === 'string' ? (SEARCH_TABS[tab] ?? 1) : tab;
    const data = await this.get(PATHS.searchTab, [
      ['query', keyword],
      ['offset', String(offset)],
      ['count', String(count)],
      ['tab_type', String(tabType)],
      ['search_source', '1'],
      ['tab_name', 'feed'],
      ['user_is_login', '0'],
    ]);
    const tabs = data.search_tabs || [];
    const selected = tabs.find((t) => t.tab_type === tabType) || tabs[0] || {};
    const books = collectBooks(selected.data || []);
    return {
      books,
      tabType,
      tabs: tabs.map((t) => ({ tabType: t.tab_type, title: t.title })),
      selectedTabIndex: num(data.selected_tab_idx),
      raw: data,
    };
  }

  // 目录 + 书籍信息。tabType 0 才会返回章节列表（实测）。
  async catalog(bookId) {
    const data = await this.get(PATHS.directory, [
      ['book_id', String(bookId)],
      ['need_book_info', '1'],
      ['tab_type', '0'],
    ]);
    const items = data.item_data_list || [];
    return {
      book: data.book_info ? normalizeBook(data.book_info) : null,
      chapters: items.map((it, i) => normalizeChapter(it, i)),
      volumes: data.catalog_data || null,
      raw: data,
    };
  }

  async bookInfo(bookId) {
    const { book } = await this.catalog(bookId);
    return book;
  }

  // 单章正文：自动处理'密钥过期'（crypt_status=2）并解密。
  async chapter(bookId, itemId, { paragraphs = true } = {}) {
    const pairs = [['book_id', String(bookId)], ['item_id', String(itemId)]];
    let data = await this.get(PATHS.readerFull, pairs);
    if (num(data.crypt_status) === 2) {
      await this.#ensureKey(num(data.key_version));
      data = await this.get(PATHS.readerFull, pairs);
    }
    const contentKey = await this.#ensureKey(num(data.key_version));
    const markup = decryptChapterContent(data.content, contentKey, num(data.compress_status));
    const lines = paragraphs ? markupToText(markup) : [markup];
    return {
      itemId: String(itemId),
      title: text(data.title).trim(),
      keyVersion: num(data.key_version),
      cryptStatus: num(data.crypt_status),
      compressed: num(data.compress_status) === 1,
      paragraphs: lines,
      text: lines.join('\n'),
    };
  }

  // 按章节序号取正文（0 起）。
  async readChapterByIndex(bookId, index = 0) {
    const { chapters } = await this.catalog(bookId);
    if (index < 0 || index >= chapters.length) throw new Error('章节序号越界: ' + index);
    const ch = chapters[index];
    const body = await this.chapter(bookId, ch.itemId);
    return { ...body, chapter: ch };
  }

  // 取可用于某个 key_version 的内容密钥。
  // 服务端把 keyver 当作"客户端已持有的版本"，传一个它没发过的版本会返回
  // "req.keyver not support"，所以默认用 0 让服务端分配，只有 0 被拒时才带上具体版本。
  async #ensureKey(version) {
    if (this.contentKey && (version === 0 || this.contentKey.keyVersion === version)) {
      return this.contentKey.keyHex;
    }
    if (!this.#keyTried) this.#keyTried = new Set();
    if (this.contentKey && this.#keyTried.has(version)) {
      // 已经为该版本协商过，仍不匹配就直接用现有密钥（解密失败会由上层报错）。
      return this.contentKey.keyHex;
    }
    this.#keyTried.add(version);
    try {
      const key = await this.registerContentKey('0', 0);
      return key.keyHex;
    } catch (err) {
      if (version !== 0) {
        const key = await this.registerContentKey('0', version);
        return key.keyHex;
      }
      throw err;
    }
  }

  #keyTried = null;
}

