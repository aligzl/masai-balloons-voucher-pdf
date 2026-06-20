import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

/**
 * Standalone flight-voucher PDF renderer (extracted from the main app to keep
 * its Cloudflare worker under the 3 MiB size limit). Fonts are read from the
 * shared R2 bucket bound as `BLOB`. Standard PDF fonts lack Turkish (ş/ğ/ı) and
 * Chinese glyphs, so we embed Noto Sans (Latin) / Noto Sans SC (Chinese).
 *
 * Upload the fonts to R2 under these flat keys (done from the main app's
 * /api/admin/fonts-seed): `NotoSans-Regular.ttf` and `NotoSansSC-Regular.ttf`.
 */

const FONT_KEY_LATIN = 'NotoSans-Regular.ttf'
const FONT_KEY_CJK = 'NotoSansSC-Regular.ttf'

export type VoucherLocale = 'en' | 'tr' | 'de' | 'fr' | 'es' | 'ch'

export interface VoucherInput {
  referenceCode: string
  name: string
  zoneName: Record<string, string> | null
  zoneSlug: string
  flightDate: string
  guests: number
  passengerNames: string[] | null
  hotel: string | null
  wantsVideo: boolean
  videoPrice: number | null
  videoCurrency: string | null
  locale: VoucherLocale
  brandName: string
}

const C = {
  ember: rgb(0.722, 0.451, 0.2),
  ink: rgb(0.102, 0.071, 0.031),
  body: rgb(0.227, 0.227, 0.227),
  muted: rgb(0.541, 0.478, 0.408),
  hairline: rgb(0.925, 0.894, 0.847),
  cloud: rgb(0.941, 0.929, 0.902),
  white: rgb(1, 1, 1)
} as const

const fontCache = new Map<string, ArrayBuffer>()

async function loadFontBytes(bucket: R2Bucket, key: string): Promise<ArrayBuffer | null> {
  const cached = fontCache.get(key)
  if (cached) return cached
  const obj = await bucket.get(key)
  if (!obj) return null
  const buf = await obj.arrayBuffer()
  fontCache.set(key, buf)
  return buf
}

interface VoucherCopy {
  title: string
  tagline: string
  reference: string
  issuedTo: string
  detailsHeading: string
  labels: { zone: string, flightDate: string, guests: string, passengers: string, hotel: string, video: string }
  termsHeading: string
  terms: string[]
  footer: string
}

const VOUCHER_INCLUDED: Record<VoucherLocale, string> = {
  en: 'Included',
  tr: 'Dahil',
  de: 'Inklusive',
  fr: 'Inclus',
  es: 'Incluido',
  ch: '已包含'
}

const VOUCHER_COPY: Record<VoucherLocale, VoucherCopy> = {
  en: {
    title: 'Flight Voucher',
    tagline: 'Hot air balloon safari over the Masai Mara',
    reference: 'Reference',
    issuedTo: 'Issued to',
    detailsHeading: 'Flight details',
    labels: { zone: 'Zone', flightDate: 'Flight date', guests: 'Guests', passengers: 'Passengers', hotel: 'Hotel', video: 'Flight video' },
    termsHeading: 'Terms & important information',
    terms: [
      'Hot air balloon flights are entirely weather-dependent and may be cancelled at short notice for your safety. If a flight is cancelled, you may transfer to the next available flight — or, if you would rather not or are unable to, receive a full refund.',
      'A safety briefing is held the day before your flight. Please stay reachable so we can confirm the briefing time and your pickup details.',
      'Minimum age is 7 years, and children must be tall enough to see over the edge of the basket and stand unaided for the full flight. Younger children cannot be carried.',
      'Flights are not permitted for pregnant women and are not suitable for guests with serious back, neck or heart conditions, brittle bones, or recent surgery.',
      'Guests weighing more than 120 kg must inform us in advance so we can balance the basket; an additional fee may apply.',
      'Wear closed-toe shoes and warm, layered clothing. Dawn launches are cold and the ground is often wet with dew.',
      'Follow all instructions from your pilot and ground crew at all times. Operating drones and throwing any object from the basket are strictly prohibited.',
      'Please be ready for pickup at your hotel on time. Late arrivals may miss the flight and forfeit the booking.',
      'This voucher is valid only for the confirmed flight date. Please keep your reference code for all correspondence.'
    ],
    footer: 'Present this voucher on the day of your flight. We look forward to flying with you.'
  },
  tr: {
    title: 'Uçuş Voucher\'ı',
    tagline: 'Masai Mara üzerinde sıcak hava balonu safarisi',
    reference: 'Referans',
    issuedTo: 'Düzenlenen kişi',
    detailsHeading: 'Uçuş detayları',
    labels: { zone: 'Bölge', flightDate: 'Uçuş tarihi', guests: 'Misafir', passengers: 'Yolcular', hotel: 'Otel', video: 'Uçuş videosu' },
    termsHeading: 'Şartlar ve önemli bilgiler',
    terms: [
      'Sıcak hava balonu uçuşları tamamen hava koşullarına bağlıdır ve güvenliğiniz için kısa süre önceden iptal edilebilir. Uçuş iptal edilirse uygun olan bir sonraki uçuşa aktarılabilirsiniz; istemezseniz veya vaktiniz yoksa ücretin tamamı iade edilir.',
      'Uçuştan bir gün önce güvenlik brifingi verilir. Brifing saatini ve alış (pickup) detaylarını teyit edebilmemiz için lütfen ulaşılabilir olun.',
      'Asgari yaş 7\'dir ve çocukların sepetin kenarından bakabilecek boyda olması ve uçuş boyunca desteksiz ayakta durabilmesi gerekir. Daha küçük çocuklar uçuşa kabul edilmez.',
      'Uçuşlar hamileler için uygun değildir; ciddi sırt, boyun veya kalp rahatsızlığı, kemik kırılganlığı ya da yakın zamanda ameliyat geçirmiş misafirler için önerilmez.',
      '120 kg\'dan ağır misafirlerin, sepet dengesini sağlayabilmemiz için bizi önceden bilgilendirmesi gerekir; ek ücret uygulanabilir.',
      'Kapalı ayakkabı ve katmanlı, sıcak kıyafet giyin. Gün doğumu kalkışları soğuktur ve zemin genellikle çiyle ıslaktır.',
      'Pilotunuzun ve yer ekibinin tüm talimatlarına her zaman uyun. Drone kullanmak ve sepetten herhangi bir cisim atmak kesinlikle yasaktır.',
      'Lütfen otelinizden alınmak üzere zamanında hazır olun. Geç kalanlar uçuşu kaçırabilir ve rezervasyon hakkını kaybedebilir.',
      'Bu voucher yalnızca onaylanan uçuş tarihi için geçerlidir. Lütfen referans kodunuzu tüm yazışmalar için saklayın.'
    ],
    footer: 'Bu voucher\'ı uçuş gününde ibraz edin. Sizinle uçmayı dört gözle bekliyoruz.'
  },
  de: {
    title: 'Fluggutschein',
    tagline: 'Heißluftballon-Safari über der Masai Mara',
    reference: 'Referenz',
    issuedTo: 'Ausgestellt für',
    detailsHeading: 'Flugdetails',
    labels: { zone: 'Region', flightDate: 'Flugdatum', guests: 'Gäste', passengers: 'Passagiere', hotel: 'Hotel', video: 'Flugvideo' },
    termsHeading: 'Bedingungen & wichtige Hinweise',
    terms: [
      'Heißluftballonflüge sind vollständig wetterabhängig und können zu Ihrer Sicherheit kurzfristig abgesagt werden. Wird ein Flug abgesagt, können Sie auf den nächsten verfügbaren Flug umbuchen – oder, wenn Sie das nicht möchten oder keine Zeit haben, eine vollständige Rückerstattung erhalten.',
      'Am Tag vor Ihrem Flug findet ein Sicherheitsbriefing statt. Bitte bleiben Sie erreichbar, damit wir die Briefing-Zeit und Ihre Abholdetails bestätigen können.',
      'Das Mindestalter beträgt 7 Jahre, und Kinder müssen groß genug sein, um über den Korbrand zu sehen, und während des gesamten Fluges ohne Hilfe stehen können. Jüngere Kinder können nicht mitgenommen werden.',
      'Flüge sind für Schwangere nicht gestattet und nicht geeignet für Gäste mit schweren Rücken-, Nacken- oder Herzbeschwerden, brüchigen Knochen oder kürzlichen Operationen.',
      'Gäste mit mehr als 120 kg müssen uns im Voraus informieren, damit wir den Korb ausbalancieren können; eine zusätzliche Gebühr kann anfallen.',
      'Tragen Sie geschlossene Schuhe und warme Kleidung in Schichten. Starts bei Sonnenaufgang sind kalt und der Boden ist oft feucht vom Tau.',
      'Befolgen Sie jederzeit alle Anweisungen Ihres Piloten und der Bodencrew. Das Betreiben von Drohnen und das Werfen von Gegenständen aus dem Korb sind strengstens untersagt.',
      'Bitte seien Sie pünktlich zur Abholung an Ihrem Hotel bereit. Verspätungen können dazu führen, dass Sie den Flug verpassen und die Buchung verfällt.',
      'Dieser Gutschein gilt nur für das bestätigte Flugdatum. Bitte bewahren Sie Ihren Referenzcode für jegliche Korrespondenz auf.'
    ],
    footer: 'Legen Sie diesen Gutschein am Flugtag vor. Wir freuen uns darauf, mit Ihnen zu fliegen.'
  },
  fr: {
    title: 'Bon de Vol',
    tagline: 'Safari en montgolfière au-dessus du Masai Mara',
    reference: 'Référence',
    issuedTo: 'Délivré à',
    detailsHeading: 'Détails du vol',
    labels: { zone: 'Zone', flightDate: 'Date du vol', guests: 'Voyageurs', passengers: 'Passagers', hotel: 'Hôtel', video: 'Vidéo du vol' },
    termsHeading: 'Conditions et informations importantes',
    terms: [
      'Les vols en montgolfière dépendent entièrement des conditions météorologiques et peuvent être annulés à court préavis pour votre sécurité. En cas d\'annulation, vous pouvez être transféré sur le prochain vol disponible — ou, si vous préférez ne pas le faire ou n\'en avez pas le temps, être intégralement remboursé.',
      'Un briefing de sécurité est organisé la veille de votre vol. Merci de rester joignable afin que nous puissions confirmer l\'heure du briefing et les détails de la prise en charge.',
      'L\'âge minimum est de 7 ans, et les enfants doivent être assez grands pour voir par-dessus le bord de la nacelle et tenir debout sans aide pendant tout le vol. Les enfants plus jeunes ne peuvent pas être acceptés.',
      'Les vols ne sont pas autorisés aux femmes enceintes et ne conviennent pas aux personnes souffrant de graves problèmes de dos, de cou ou de cœur, d\'os fragiles ou ayant subi une opération récente.',
      'Les passagers de plus de 120 kg doivent nous en informer à l\'avance afin que nous puissions équilibrer la nacelle ; des frais supplémentaires peuvent s\'appliquer.',
      'Portez des chaussures fermées et des vêtements chauds en couches. Les décollages à l\'aube sont froids et le sol est souvent humide de rosée.',
      'Suivez à tout moment les instructions de votre pilote et de l\'équipe au sol. L\'utilisation de drones et le lancement de tout objet depuis la nacelle sont strictement interdits.',
      'Veuillez être prêt à l\'heure pour la prise en charge à votre hôtel. Les retardataires peuvent manquer le vol et perdre leur réservation.',
      'Ce bon n\'est valable que pour la date de vol confirmée. Veuillez conserver votre code de référence pour toute correspondance.'
    ],
    footer: 'Présentez ce bon le jour de votre vol. Nous avons hâte de voler avec vous.'
  },
  es: {
    title: 'Bono de Vuelo',
    tagline: 'Safari en globo aerostático sobre el Masai Mara',
    reference: 'Referencia',
    issuedTo: 'Emitido a',
    detailsHeading: 'Detalles del vuelo',
    labels: { zone: 'Zona', flightDate: 'Fecha del vuelo', guests: 'Pasajeros', passengers: 'Nombres de pasajeros', hotel: 'Hotel', video: 'Vídeo del vuelo' },
    termsHeading: 'Condiciones e información importante',
    terms: [
      'Los vuelos en globo aerostático dependen totalmente de las condiciones meteorológicas y pueden cancelarse con poca antelación por tu seguridad. Si se cancela un vuelo, puedes pasar al siguiente vuelo disponible o, si prefieres no hacerlo o no tienes tiempo, recibir un reembolso completo.',
      'El día antes de tu vuelo se realiza una sesión informativa de seguridad. Mantente localizable para que podamos confirmar la hora de la sesión y los detalles de la recogida.',
      'La edad mínima es de 7 años, y los niños deben ser lo bastante altos para ver por encima del borde de la barquilla y permanecer de pie sin ayuda durante todo el vuelo. No se admiten niños más pequeños.',
      'Los vuelos no están permitidos para mujeres embarazadas y no son adecuados para personas con problemas graves de espalda, cuello o corazón, huesos frágiles o cirugías recientes.',
      'Los pasajeros de más de 120 kg deben informarnos con antelación para poder equilibrar la barquilla; puede aplicarse un cargo adicional.',
      'Usa zapatos cerrados y ropa de abrigo por capas. Los despegues al amanecer son fríos y el suelo suele estar húmedo de rocío.',
      'Sigue en todo momento las instrucciones de tu piloto y del equipo de tierra. Está terminantemente prohibido usar drones y arrojar cualquier objeto desde la barquilla.',
      'Prepárate a tiempo para la recogida en tu hotel. Quienes lleguen tarde pueden perder el vuelo y la reserva.',
      'Este bono solo es válido para la fecha de vuelo confirmada. Conserva tu código de referencia para cualquier comunicación.'
    ],
    footer: 'Presenta este bono el día de tu vuelo. Esperamos volar contigo.'
  },
  ch: {
    title: '飞行凭证',
    tagline: '马赛马拉热气球观光之旅',
    reference: '预订编号',
    issuedTo: '持票人',
    detailsHeading: '飞行详情',
    labels: { zone: '区域', flightDate: '飞行日期', guests: '宾客人数', passengers: '乘客姓名', hotel: '酒店', video: '飞行视频' },
    termsHeading: '条款与重要须知',
    terms: [
      '热气球飞行完全取决于天气，为确保您的安全，可能会在短时间内取消。如航班取消，您可改期至下一个可用航班；若您不愿改期或没有时间，将获得全额退款。',
      '飞行前一天将进行安全简报。请保持电话畅通，以便我们确认简报时间及接送安排。',
      '最低年龄为 7 岁，儿童身高须能越过吊篮边缘观看，并能在整个飞行过程中独自站立。年龄更小的儿童恕不接待。',
      '孕妇不得参加飞行；患有严重背部、颈部或心脏疾病、骨质脆弱或近期接受过手术的宾客不宜参加。',
      '体重超过 120 公斤的宾客须提前告知我们，以便平衡吊篮；可能会收取额外费用。',
      '请穿着包脚鞋和保暖的多层衣物。日出起飞时天气寒冷，地面常有露水。',
      '全程请遵从飞行员和地勤人员的所有指示。严禁操作无人机或从吊篮中抛掷任何物品。',
      '请按时在酒店等候接送。迟到者可能错过飞行并丧失预订资格。',
      '本凭证仅在确认的飞行日期有效。请妥善保管您的预订编号，以备所有联系之用。'
    ],
    footer: '请在飞行当天出示本凭证。期待与您共飞。'
  }
}

const zoneName = (input: VoucherInput): string =>
  input.zoneName?.[input.locale] ?? input.zoneName?.en ?? input.zoneSlug

/** Greedy word-wrap with character-level fallback (handles space-free CJK). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = ''
        for (const ch of word) {
          const next = chunk + ch
          if (font.widthOfTextAtSize(next, size) <= maxWidth) chunk = next
          else { if (chunk) lines.push(chunk); chunk = ch }
        }
        line = chunk
      } else {
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

export async function renderVoucher(input: VoucherInput, bucket: R2Bucket): Promise<Uint8Array> {
  const copy = VOUCHER_COPY[input.locale] ?? VOUCHER_COPY.en
  const brand = input.brandName || 'Masai Balloons'

  const fontKey = input.locale === 'ch' ? FONT_KEY_CJK : FONT_KEY_LATIN
  const fontBytes = await loadFontBytes(bucket, fontKey)
  if (!fontBytes) throw new Error(`voucher font not found in R2 (${fontKey})`)

  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(fontBytes, { subset: true })

  const PAGE_W = 595.28
  const PAGE_H = 841.89
  const MARGIN = 48
  const CONTENT_W = PAGE_W - MARGIN * 2

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) newPage()
  }
  const drawText = (text: string, x: number, size: number, color = C.ink) => {
    page.drawText(text, { x, y, size, font, color })
  }
  const drawWrapped = (text: string, x: number, size: number, lineHeight: number, color: ReturnType<typeof rgb>, maxWidth = CONTENT_W) => {
    for (const line of wrapText(text, font, size, maxWidth)) {
      ensureSpace(lineHeight)
      page.drawText(line, { x, y, size, font, color })
      y -= lineHeight
    }
  }

  // Header band
  const HEADER_H = 110
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: C.ember })
  y = PAGE_H - 44
  drawText(brand, MARGIN, 20, C.white)
  y -= 26
  drawText(copy.title, MARGIN, 26, C.white)
  y -= 18
  drawText(copy.tagline, MARGIN, 10, C.cloud)

  // Reference + issued-to card
  y = PAGE_H - HEADER_H - 28
  ensureSpace(56)
  const cardH = 56
  page.drawRectangle({ x: MARGIN, y: y - cardH + 14, width: CONTENT_W, height: cardH, color: C.cloud, borderColor: C.hairline, borderWidth: 1 })
  drawText(copy.reference.toUpperCase(), MARGIN + 16, 9, C.muted)
  y -= 18
  drawText(input.referenceCode, MARGIN + 16, 22, C.ember)
  drawText(copy.issuedTo.toUpperCase(), MARGIN + CONTENT_W / 2 + 16, 9, C.muted)
  y -= 22
  drawText(input.name, MARGIN + CONTENT_W / 2 + 16, 14, C.ink)

  // Flight details
  y -= 40
  ensureSpace(24)
  drawText(copy.detailsHeading, MARGIN, 14, C.ember)
  y -= 8

  const rows: Array<[string, string]> = [
    [copy.labels.zone, zoneName(input)],
    [copy.labels.flightDate, input.flightDate],
    [copy.labels.guests, String(input.guests)],
    [copy.labels.passengers, (input.passengerNames?.length ? input.passengerNames : [input.name]).join(', ')],
    ...(input.hotel ? [[copy.labels.hotel, input.hotel] as [string, string]] : []),
    ...(input.wantsVideo ? [[copy.labels.video, VOUCHER_INCLUDED[input.locale] ?? VOUCHER_INCLUDED.en] as [string, string]] : [])
  ]

  const LABEL_X = MARGIN
  const VALUE_X = MARGIN + 150
  const VALUE_W = CONTENT_W - 150
  for (const [label, value] of rows) {
    const valueLines = wrapText(value, font, 11, VALUE_W)
    const rowH = Math.max(18, valueLines.length * 15) + 8
    ensureSpace(rowH)
    const baseline = y - 13
    page.drawText(label, { x: LABEL_X, y: baseline, size: 10, font, color: C.muted })
    let vy = baseline
    for (const line of valueLines) {
      page.drawText(line, { x: VALUE_X, y: vy, size: 11, font, color: C.ink })
      vy -= 15
    }
    y -= rowH
    page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_W - MARGIN, y: y + 4 }, thickness: 0.5, color: C.hairline })
  }

  // Terms
  y -= 24
  ensureSpace(24)
  drawText(copy.termsHeading, MARGIN, 14, C.ember)
  y -= 22
  copy.terms.forEach((term, i) => {
    drawText(`${i + 1}.`, MARGIN, 10, C.ember)
    drawWrapped(term, MARGIN + 18, 9.5, 13, C.body, CONTENT_W - 18)
    y -= 6
  })

  // Footer
  y -= 14
  ensureSpace(30)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: C.hairline })
  y -= 18
  drawWrapped(copy.footer, MARGIN, 10, 14, C.muted)

  return doc.save()
}
