/**
 * Prompt Config — AI Learning Prompt Template
 * 
 * This file defines the template for generating AI prompts when a player 
 * copies a solved word from the crossword game. Edit this file to customize 
 * the prompt format without touching the main application code.
 * 
 * Parameters:
 *   word    — The solved crossword word (e.g. "MITOSIS")
 *   clueEn  — The English clue for the word
 *   clueTh  — The Thai (2nd language) clue for the word, may be empty
 */
function buildWordPrompt(word, clueEn, clueTh) {
    const thaiPart = clueTh ? `"${clueTh}" ` : '';
    return `ผมเล่น crossword ได้รับคำ "${word}" พร้อมทั้ง คำใบ้ที่เป็นไทยและ english ${thaiPart}"${clueEn}" ผมอยากให้คุณช่วยอธิบายว่าคำที่ผมได้มันคืออะไรแล้วเกียวข้องอย่างไรกับคำใบ้ช่วยอธิบายให้เห็นภาพและเข้าใจ`;
}
