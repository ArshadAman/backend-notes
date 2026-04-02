// Configuration & State
let notesData = [];
let currentHash = '';
let hasShownMidRead = false;
let hasShownEntryPopup = false;
let scrollSpyObserver = null;

// DOM Elements
const elements = {
    notesList: document.getElementById('notes-list'),
    searchInput: document.getElementById('sidebar-search'),
    noSearchResults: document.getElementById('no-search-results'),
    contentContainer: document.getElementById('content-container'),
    markdownBody: document.getElementById('markdown-body'),
    articleHeader: document.getElementById('article-header'),
    readTime: document.getElementById('read-time'),
    welcomeState: document.getElementById('welcome-state'),
    loader: document.getElementById('loader'),
    tocSidebar: document.getElementById('toc-sidebar'),
    tocContent: document.getElementById('toc-content'),
    progressBar: document.getElementById('scroll-progress'),
    bottomCta: document.getElementById('bottom-cta'),
    mobileOverlay: document.getElementById('mobile-overlay'),
    sidebar: document.getElementById('sidebar'),
    themeToggle: document.getElementById('theme-toggle'),
    themeToggleDarkIcon: document.getElementById('theme-toggle-dark-icon'),
    themeToggleLightIcon: document.getElementById('theme-toggle-light-icon'),
    entryPopup: document.getElementById('entry-popup'),
    midReadToast: document.getElementById('mid-read-toast')
};

// ==================== INIT ====================
async function init() {
    setupTheme();
    setupMarked();
    setupEventListeners();
    fetchInstagramStats();
    await fetchNotesList();
    handleRoute();
    setupScrollEngagement();
}

// ==================== INSTAGRAM STATS ====================
async function fetchInstagramStats() {
    try {
        const targetUrl = 'https://www.instagram.com/the.he24/';
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
        const response = await fetch(proxyUrl);
        const data = await response.json();
        
        if (data.contents) {
            // Followers / Following
            const match = data.contents.match(/content="([0-9,KMB]+)\s+Followers,\s+([0-9,KMB]+)\s+Following/i) || 
                          data.contents.match(/"([0-9,KMB]+)\s+Followers,\s+([0-9,KMB]+)\s+Following/i);
            if (match) {
                document.querySelectorAll('.ig-followers-count').forEach(el => el.textContent = match[1]);
                document.querySelectorAll('.ig-following-count').forEach(el => el.textContent = match[2]);
            }
            
            // Profile Image from og:image
            const imgMatch = data.contents.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
            if (imgMatch && imgMatch[1]) {
                const avatarUrl = imgMatch[1].replace(/&amp;/g, '&');
                document.querySelectorAll('.ig-avatar-img').forEach(img => {
                    img.src = avatarUrl;
                });
            }
        }
    } catch (e) {
        console.warn('Could not fetch live stats:', e);
    }
}

// ==================== MARKED.JS ====================
function setupMarked() {
    marked.setOptions({
        highlight: function(code, lang) {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext';
            return hljs.highlight(code, { language }).value;
        },
        gfm: true,
        breaks: true,
        headerIds: true
    });
}

// ==================== FETCH NOTES ====================
async function fetchNotesList() {
    try {
        const res = await fetch('notes.json');
        if (!res.ok) throw new Error('Failed to fetch notes index');
        notesData = await res.json();
        renderSidebar(notesData);
        renderNotesGrid(notesData);
    } catch (err) {
        console.error('Error loading notes:', err);
        elements.notesList.innerHTML = `<li class="text-red-500 px-4 py-2 text-sm">Failed to load notes list.</li>`;
    }
}

// ==================== NOTES GRID (Landing Page) ====================
function renderNotesGrid(notes) {
    const grid = document.getElementById('notes-grid');
    if (!grid) return;
    
    // Update post counts
    const pc = document.getElementById('profile-notes-count');
    const pcm = document.getElementById('profile-notes-count-mobile');
    if (pc) pc.textContent = notes.length;
    if (pcm) pcm.textContent = notes.length;

    grid.innerHTML = '';

    notes.forEach((note, idx) => {

        // Card container
        const item = document.createElement('a');
        item.href = `#${note.filename.replace('.md', '')}`;
        item.className = [
            'gsap-card group relative aspect-square',
            'cursor-pointer block overflow-hidden',
            'border border-[#2a2a2a] hover:border-[#444]',
            'transition-all duration-300',
            'bg-[#141414] hover:bg-[#1a1a1a]'
        ].join(' ');

        // Title
        const titleClasses = [
            'text-[#e0e0e0] group-hover:text-white',
            'font-semibold text-[14px] md:text-[18px]',
            'leading-snug tracking-tight',
            'transition-colors duration-300'
        ].join(' ');

        // Hover overlay
        const overlayClasses = [
            'absolute inset-0 opacity-0 group-hover:opacity-100',
            'transition-all duration-400 bg-black/60',
            'flex items-center justify-center z-20'
        ].join(' ');

        item.innerHTML = `
            <div class="absolute inset-0 flex flex-col items-center justify-center p-4 md:p-6 text-center z-10">
                <h3 class="${titleClasses}">${note.title}</h3>
            </div>
            <div class="${overlayClasses}">
                <span class="text-white text-[13px] md:text-[14px] font-semibold tracking-wide">Read →</span>
            </div>
            <div class="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#0095f6]/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        `;

        grid.appendChild(item);
    });
    
    // GSAP entrance
    if (window.gsap) {
        gsap.fromTo('.gsap-card', 
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.6, stagger: 0.04, ease: 'power2.out', delay: 0.1 }
        );
    }
}

// ==================== SIDEBAR ====================
function renderSidebar(notes) {
    if (notes.length === 0) {
        elements.notesList.innerHTML = '';
        elements.noSearchResults.classList.remove('hidden');
        return;
    }
    
    elements.noSearchResults.classList.add('hidden');
    elements.notesList.innerHTML = notes.map(note => {
        const hash = `#${note.filename.replace('.md', '')}`;
        const isActive = currentHash === hash;
        return `
            <li>
                <a href="${hash}" 
                   class="block px-3 py-3 rounded-lg text-[15px] transition-all duration-200 
                   ${isActive 
                       ? 'font-bold text-ig-lightText dark:text-ig-darkText bg-ig-hoverLight dark:bg-[#121212]' 
                       : 'font-normal text-ig-lightText dark:text-ig-darkText hover:bg-ig-hoverLight dark:hover:bg-[#121212]'}">
                    ${note.title}
                </a>
            </li>
        `;
    }).join('');
}

// ==================== ROUTING ====================
function handleRoute() {
    const hash = window.location.hash;
    currentHash = hash;
    renderSidebar(notesData);
    
    if (!hash) {
        showWelcomeState();
        return;
    }

    const noteId = hash.slice(1);
    const note = notesData.find(n => n.filename.replace('.md', '') === noteId);

    if (note) {
        loadMarkdown(note.path);
        if (window.innerWidth < 1024) {
            toggleMobileMenu(false);
        }
    } else {
        showWelcomeState();
    }
}

// ==================== LOAD MARKDOWN ====================
async function loadMarkdown(path) {
    // Switch from landing to reading mode
    document.body.classList.remove('landing-mode');
    elements.welcomeState.classList.add('hidden');
    elements.welcomeState.style.display = ''; // Clear any inline display override
    elements.markdownBody.innerHTML = '';
    elements.bottomCta.classList.add('hidden');
    elements.articleHeader.classList.add('hidden');
    elements.tocSidebar.classList.add('opacity-0');
    elements.tocSidebar.classList.remove('opacity-100');
    elements.loader.classList.remove('hidden');
    hasShownMidRead = false;
    sessionStorage.removeItem('he_mid_seen');
    window.scrollTo({ top: 0, behavior: 'instant' });

    try {
        const res = await fetch(path);
        if (!res.ok) throw new Error('File not found');
        const text = await res.text();
        
        setTimeout(() => {
            renderContent(text);
        }, 120);
        
    } catch (err) {
        elements.loader.classList.add('hidden');
        elements.markdownBody.innerHTML = `<div class="text-red-500 font-medium py-10 text-center">Failed to load content for ${path}</div>`;
    }
}

// ==================== RENDER CONTENT ====================
function renderContent(markdownString) {
    elements.loader.classList.add('hidden');
    
    const htmlContent = marked.parse(markdownString);
    elements.markdownBody.innerHTML = htmlContent;
    
    // Meta data
    const readTime = Math.ceil(markdownString.split(/\s+/).length / 200);
    elements.readTime.textContent = `${readTime} min read`;
    elements.articleHeader.classList.remove('hidden');
    elements.bottomCta.classList.remove('hidden');
    
    addCopyButtons();
    wrapTables();
    generateTOC();
    setupScrollSpy();
    
    // GSAP content entrance
    if (window.gsap) {
        gsap.fromTo('#markdown-body > *', 
            { y: 15, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.5, stagger: 0.02, ease: 'power2.out' }
        );
    }
    
    // Show entry popup (Instagram-style auth wall)
    triggerEntryPopup();
}

// ==================== WELCOME STATE ====================
function showWelcomeState() {
    document.body.classList.add('landing-mode');
    elements.loader.classList.add('hidden');
    elements.articleHeader.classList.add('hidden');
    elements.markdownBody.innerHTML = '';
    elements.bottomCta.classList.add('hidden');
    elements.tocSidebar.classList.add('opacity-0');
    elements.welcomeState.classList.remove('hidden');
    elements.welcomeState.style.display = 'flex';
}

// ==================== TOC ====================
function generateTOC() {
    const headings = elements.markdownBody.querySelectorAll('h1, h2, h3, h4');
    if (headings.length === 0) return;

    let tocHTML = '';
    headings.forEach((heading, index) => {
        if (!heading.id) {
            heading.id = heading.textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        }
        if (Array.from(headings).findIndex(h => h.id === heading.id) !== index) {
            heading.id = `${heading.id}-${index}`;
        }
        const level = parseInt(heading.tagName.substring(1));
        const paddingClass = level === 1 || level === 2 ? '' : `toc-level-${level}`;
        tocHTML += `<a href="#${heading.id}" class="toc-link ${paddingClass}" data-target="${heading.id}">${heading.textContent}</a>`;
    });

    elements.tocContent.innerHTML = tocHTML;
    
    setTimeout(() => {
        elements.tocSidebar.classList.remove('opacity-0');
        elements.tocSidebar.classList.add('opacity-100');
    }, 100);

    document.querySelectorAll('.toc-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = e.target.getAttribute('href').substring(1);
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}

// ==================== SCROLL SPY ====================
function setupScrollSpy() {
    const headings = elements.markdownBody.querySelectorAll('h1, h2, h3, h4');
    const tocLinks = document.querySelectorAll('.toc-link');
    if (headings.length === 0) return;

    window.addEventListener('scroll', () => {
        let currentId = '';
        headings.forEach(heading => {
            if (heading.getBoundingClientRect().top < 100) {
                currentId = heading.id;
            }
        });
        
        tocLinks.forEach(link => {
            link.classList.remove('active');
            if (link.dataset.target === currentId) {
                link.classList.add('active');
                const container = elements.tocSidebar;
                const linkOffset = link.offsetTop;
                if (linkOffset > container.scrollTop + container.clientHeight - 50 || linkOffset < container.scrollTop + 50) {
                    container.scrollTo({ top: linkOffset - container.clientHeight / 2, behavior: 'smooth' });
                }
            }
        });
    }, { passive: true });
}

// ==================== COPY BUTTONS ====================
function addCopyButtons() {
    elements.markdownBody.querySelectorAll('pre').forEach(block => {
        if (block.querySelector('.copy-btn')) return;
        const button = document.createElement('button');
        button.className = 'copy-btn';
        button.innerHTML = 'Copy';
        button.onclick = async () => {
            const code = block.querySelector('code').innerText;
            try {
                await navigator.clipboard.writeText(code);
                button.innerHTML = 'Copied!';
                button.classList.add('copied');
                setTimeout(() => { button.innerHTML = 'Copy'; button.classList.remove('copied'); }, 2000);
            } catch (err) { button.innerHTML = 'Failed'; }
        };
        block.appendChild(button);
    });
}

// ==================== RESPONSIVE TABLES ====================
function wrapTables() {
    elements.markdownBody.querySelectorAll('table').forEach(table => {
        const wrapper = document.createElement('div');
        wrapper.style.overflowX = 'auto';
        wrapper.style.marginBottom = '1.75em';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
        table.style.marginBottom = '0';
    });
}

// ==================== SEARCH ====================
function searchNotes(query) {
    const lowerQuery = query.toLowerCase();
    const filtered = notesData.filter(note => {
        return note.title.toLowerCase().includes(lowerQuery) || note.filename.toLowerCase().includes(lowerQuery);
    });
    renderSidebar(filtered);
}

// ==================== THEME ====================
function setupTheme() {
    if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        elements.themeToggleLightIcon.classList.remove('hidden');
    } else {
        document.documentElement.classList.remove('dark');
        elements.themeToggleDarkIcon.classList.remove('hidden');
    }
}

function toggleTheme() {
    elements.themeToggleDarkIcon.classList.toggle('hidden');
    elements.themeToggleLightIcon.classList.toggle('hidden');
    if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('color-theme', 'light');
    } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('color-theme', 'dark');
    }
}

// ==================== MOBILE MENU ====================
function toggleMobileMenu(forceState) {
    const isOpening = forceState !== undefined ? forceState : elements.sidebar.classList.contains('-translate-x-full');
    if (isOpening) {
        elements.sidebar.classList.remove('-translate-x-full');
        elements.mobileOverlay.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
    } else {
        elements.sidebar.classList.add('-translate-x-full');
        elements.mobileOverlay.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }
}

// ==================== POPUPS ====================
function triggerEntryPopup() {
    // Always show popup when opening a note (like IG auth wall)
    // Use sessionStorage so it only shows once per browser session
    if (sessionStorage.getItem('he_popup_shown')) return;
    
    setTimeout(() => {
        if (!document.hidden && currentHash !== '') {
            elements.entryPopup.classList.remove('hidden');
            setTimeout(() => {
                elements.entryPopup.classList.remove('opacity-0', 'pointer-events-none');
                const inner = elements.entryPopup.querySelector('div');
                if (inner) inner.classList.remove('scale-95');
            }, 10);
            sessionStorage.setItem('he_popup_shown', 'true');
        }
    }, 1200);
}

function setupScrollEngagement() {
    window.addEventListener('scroll', () => {
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrolled = window.scrollY;
        const progress = docHeight > 0 ? (scrolled / docHeight) * 100 : 0;
        
        // Progress bar
        elements.progressBar.style.width = `${progress}%`;

        // Mid-read toast at ~50%
        if (!hasShownMidRead && progress >= 45 && progress <= 55 && elements.markdownBody.innerHTML !== '') {
            showToast();
        }
        
        // End-of-article popup at ~90%
        if (progress >= 88 && elements.markdownBody.innerHTML !== '' && !sessionStorage.getItem('he_end_popup_shown')) {
            triggerEndPopup();
        }
    }, { passive: true });
}

function triggerEndPopup() {
    sessionStorage.setItem('he_end_popup_shown', 'true');
    elements.entryPopup.classList.remove('hidden');
    setTimeout(() => {
        elements.entryPopup.classList.remove('opacity-0', 'pointer-events-none');
        const inner = elements.entryPopup.querySelector('div');
        if (inner) inner.classList.remove('scale-95');
    }, 10);
}

function dismissPopup(id) {
    const popup = document.getElementById(id);
    if (popup) {
        popup.classList.add('opacity-0', 'pointer-events-none');
        const inner = popup.querySelector('div');
        if (inner) inner.classList.add('scale-95');
        setTimeout(() => popup.classList.add('hidden'), 300);
    }
}

function showToast() {
    hasShownMidRead = true;
    sessionStorage.setItem('he_mid_seen', 'true');
    elements.midReadToast.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
    elements.midReadToast.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
    setTimeout(() => { dismissToast(); }, 8000);
}

function dismissToast() {
    elements.midReadToast.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
    elements.midReadToast.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    window.addEventListener('hashchange', handleRoute);
    elements.searchInput.addEventListener('input', (e) => searchNotes(e.target.value));
    elements.themeToggle.addEventListener('click', toggleTheme);
}

// ==================== START ====================
init();
