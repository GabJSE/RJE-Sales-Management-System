const replies = {
  tagalog: {
    5: ["Maraming salamat po sa magandang review! Masaya kaming nagustuhan ninyo ang produkto.", "Salamat na salamat po sa tiwala sa RJE Motorparts! Natutuwa kaming naging maganda ang experience ninyo."],
    4: ["Maraming salamat po sa inyong feedback! Pinahahalagahan namin ito at patuloy pa naming pagagandahin ang serbisyo.", "Salamat po sa magandang rating at feedback. Malaking tulong po ito para mas mapabuti pa namin ang inyong experience."],
    3: ["Salamat po sa inyong feedback. Maaari po ninyong sabihin kung ano pa ang maaari naming mapabuti para mas maging maayos ang inyong experience?", "Salamat po sa tapat na review. Nais naming mas mapaganda ang serbisyo—maaari po kayong makipag-ugnayan sa shop kung may maitutulong kami."],
    low: ["Paumanhin po sa abalang naranasan ninyo. Mangyaring makipag-ugnayan sa amin sa pamamagitan ng TikTok Shop chat para matulungan namin kayo nang maayos.", "Ikinalulungkot po namin na hindi naging maayos ang inyong experience. Nandito po kami para tumulong—maaari ninyo kaming i-message sa TikTok Shop chat."],
  },
  taglish: {
    5: ["Maraming salamat po sa great review! Happy kami na nagustuhan ninyo ang product.", "Thank you so much po sa tiwala sa RJE Motorparts! Glad kami na naging maganda ang experience ninyo."],
    4: ["Thank you po sa rating at feedback! We appreciate it at patuloy naming iimprove ang service.", "Maraming salamat po sa feedback. Malaking tulong ito para mas mapaganda pa namin ang customer experience."],
    3: ["Salamat po sa honest feedback. Please let us know kung ano pa ang maaari naming ma-improve para sa susunod.", "Thank you po sa review. Maaari ninyo kaming i-message sa TikTok Shop chat kung may concern na kailangan naming matulungan."],
    low: ["Sorry po sa inconvenience na naranasan ninyo. Please message us through TikTok Shop chat para ma-assist namin kayo nang maayos.", "Ikinalulungkot po namin ang naging experience ninyo. Kindly contact us sa TikTok Shop chat so we can properly assist you."],
  },
  english: {
    5: ["Thank you very much for the wonderful review! We’re glad you’re happy with the product.", "Thank you for trusting RJE Motorparts! We truly appreciate your support and positive feedback."],
    4: ["Thank you for your rating and helpful feedback. We appreciate it and will continue improving our service.", "Thank you for sharing your experience. Your feedback helps us serve our customers better."],
    3: ["Thank you for your honest feedback. Please let us know what we could improve to make your next experience better.", "Thank you for your review. If you need assistance, please contact us through TikTok Shop chat so we can help."],
    low: ["We’re sorry for the inconvenience you experienced. Please contact us through TikTok Shop chat so we can assist you properly.", "We’re sorry your experience did not meet expectations. Please message us through TikTok Shop chat and we’ll do our best to assist."],
  },
};

const bucket = rating => rating <= 2 ? "low" : String(rating);
export function generateReviewReply(review, settings) {
  const language = settings.language || "tagalog"; const key = bucket(review.rating); const custom = settings.templates?.[language]?.[key]; const choices = Array.isArray(custom) && custom.filter(Boolean).length ? custom.filter(Boolean) : replies[language]?.[key] || replies.tagalog[key];
  const seed = [...String(review._id || review.externalReviewId || review.productName)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return { text: choices[seed % choices.length], language, tone: settings.tone || "friendly" };
}

export const defaultReviewTemplates = replies;
