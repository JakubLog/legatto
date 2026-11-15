import { Fragment, useEffect } from 'react';
import { ArrowRight, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePublicOffices } from '@/hooks/useOffices';
import { useSiteContent } from '@/hooks/useSiteContent';
import { PublicCalendarSection } from '@/components/public/PublicCalendarSection';
import { PublicOfficeCard } from '@/components/public/PublicOfficeCard';
import { PublicOfficesMap } from '@/components/public/PublicOfficesMap';
import { PublicPageSkeleton } from '@/components/public/PublicPageSkeleton';
import { PublicSubmissionForm } from '@/components/public/PublicSubmissionForm';
import { SectionHeading } from '@/components/public/SectionHeading';
import { telHref } from '@/components/public/officeLinks';
import {
  publicBtn,
  publicCard,
  publicContainer,
  publicFocus,
  publicH1,
  publicInner,
  publicKicker,
  publicSection,
  publicSkeleton,
} from '@/components/public/styles';
import { PUBLIC_TEMPLATES } from '@/lib/publicTheme';
import { DEFAULT_SITE_CONTENT, HOMEPAGE_SECTION_ANCHORS, type HomepageSectionId } from '@/lib/siteContent';
import { cn } from '@/lib/utils';

const inlineLink = cn('rounded font-semibold text-brand underline-offset-2 hover:underline', publicFocus);

/** Tła sekcji pod hero (biel) naprzemiennie: krem, biel, krem... - niezależnie od kolejności sekcji. */
const SECTION_TONES = ['bg-background', 'bg-card'] as const;

export default function HomePage() {
  const siteQ = useSiteContent();
  const { data: offices = [], isLoading: officesLoading } = usePublicOffices();
  const phoneOffice = offices.find((office) => office.phone);

  // Sekcje z kotwicami powstają dopiero po odpowiedzi RPC, więc wejście na /#zglos przewijamy ręcznie.
  const contentReady = !siteQ.isPending;
  useEffect(() => {
    if (!contentReady || !window.location.hash) return;
    // Błędny ciąg procentowy (np. /#%) rzuca URIError - wtedy po prostu nie przewijamy.
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    document.getElementById(id)?.scrollIntoView();
  }, [contentReady]);

  // Do odpowiedzi RPC szkielet (bez mignięcia domyślnych tekstów); błąd -> treść domyślna.
  if (!contentReady) return <PublicPageSkeleton />;
  const { identity, homepage } = siteQ.data ?? DEFAULT_SITE_CONTENT;

  const enabledSections = homepage.sections.filter((s) => s.enabled);
  const officesEnabled = enabledSections.some((s) => s.id === 'offices');
  const submitEnabled = enabledSections.some((s) => s.id === 'submit');
  const officesHref = `#${HOMEPAGE_SECTION_ANCHORS.offices}`;
  const submitHref = `#${HOMEPAGE_SECTION_ANCHORS.submit}`;
  const { hero } = homepage;
  const hasPhoto = Boolean(identity.photo_url);
  const mapTitle = identity.district_label ? `Mapa: ${identity.district_label}` : 'Mapa okręgu wyborczego';
  const kicker = hero.kicker || identity.district_label;
  const showMap = homepage.offices.show_map;
  const template = PUBLIC_TEMPLATES[homepage.appearance.template];
  const heroLayout = template.hero;
  const centered = heroLayout === 'centered';
  const layout = template.sections;

  const renderSection = (id: HomepageSectionId, tone: string) => {
    const anchor = HOMEPAGE_SECTION_ANCHORS[id];
    switch (id) {
      case 'offices': {
        const stacked = layout.offices === 'stacked';
        return (
          <section id={anchor} aria-labelledby={`${anchor}-title`} className={cn('scroll-mt-20', tone, publicSection)}>
            <div className={publicContainer}>
              <div className={publicInner}>
                <SectionHeading id={`${anchor}-title`} title={homepage.offices.title} className={cn(stacked && 'mx-auto text-center')} />

                {/* Mapa obok kart (po lewej albo po prawej) albo, w jednej kolumnie, pod nimi. */}
                <div
                  className={cn(
                    'mt-8 grid items-start gap-4 md:gap-5',
                    showMap && layout.offices === 'start' && 'lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]',
                    showMap && layout.offices === 'end' && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]',
                  )}
                >
                  {showMap && (
                    <PublicOfficesMap
                      offices={offices}
                      title={mapTitle}
                      caption={homepage.offices.map_caption}
                      className={cn(layout.offices === 'end' && 'lg:order-last', stacked && 'order-last mx-auto w-full max-w-3xl')}
                    />
                  )}

                  {officesLoading ? (
                    <div
                      className={cn('grid gap-4 sm:grid-cols-2 md:gap-5', showMap && !stacked && 'lg:grid-cols-1')}
                      aria-busy="true"
                      aria-label="Ładowanie listy biur"
                    >
                      {Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className={cn(publicSkeleton, 'h-44 bg-card/70')} />
                      ))}
                    </div>
                  ) : offices.length === 0 ? (
                    homepage.offices.empty_text && (
                      <div className={cn(publicCard, 'p-8 text-center text-muted-foreground')}>{homepage.offices.empty_text}</div>
                    )
                  ) : (
                    <div className={cn('grid gap-4 sm:grid-cols-2 md:gap-5', showMap && !stacked && 'lg:grid-cols-1')}>
                      {offices.map((office) => (
                        <PublicOfficeCard key={office.id} office={office} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      }
      case 'calendar':
        return (
          <PublicCalendarSection
            title={homepage.calendar.title}
            description={homepage.calendar.description}
            layout={layout.calendar}
            className={tone}
          />
        );
      case 'submit': {
        const stacked = layout.submit === 'stacked';
        return (
          <section id={anchor} aria-labelledby={`${anchor}-title`} className={cn('scroll-mt-20', tone, publicSection)}>
            <div className={publicContainer}>
              {/* Opis z krokami obok formularza (po lewej albo po prawej) albo, w jednej kolumnie, nad nim. */}
              <div
                className={cn(
                  publicInner,
                  'grid gap-8',
                  layout.submit === 'start' && 'lg:grid-cols-[0.8fr_1.2fr] lg:gap-14',
                  layout.submit === 'end' && 'lg:grid-cols-[1.2fr_0.8fr] lg:gap-14',
                  stacked && 'max-w-3xl',
                )}
              >
                <div className={cn(stacked ? 'text-center' : 'lg:sticky lg:top-28 lg:self-start', layout.submit === 'end' && 'lg:order-last')}>
                  <SectionHeading
                    id={`${anchor}-title`}
                    title={homepage.submit.title}
                    description={homepage.submit.description}
                    className={cn(stacked && 'mx-auto')}
                  />

                  {homepage.submit.steps.length > 0 && (
                    <ol className={cn('mt-6', stacked ? 'grid gap-4 text-left sm:grid-cols-3' : 'space-y-4')} aria-label="Jak to działa">
                      {homepage.submit.steps.map(({ title, text }, idx) => (
                        <li key={idx} className="flex gap-3">
                          <span className="w-5 shrink-0 font-bold leading-6 tabular-nums text-brand" aria-hidden>
                            {idx + 1}.
                          </span>
                          <div>
                            <h3 className="font-semibold leading-6">{title}</h3>
                            {text && <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}

                  {/* Bez sekcji biur nie ma dokąd odesłać - zostaje sam telefon (albo nic). */}
                  {(officesEnabled || phoneOffice?.phone) && (
                    <p className="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
                      Wolisz porozmawiać?{' '}
                      {phoneOffice?.phone && (
                        <>
                          Zadzwoń:{' '}
                          <a href={telHref(phoneOffice.phone)} className={cn(inlineLink, 'inline-flex items-center gap-1 tabular-nums')}>
                            <Phone className="h-3.5 w-3.5" aria-hidden />
                            {phoneOffice.phone}
                          </a>
                          {officesEnabled && ' albo '}
                        </>
                      )}
                      {officesEnabled && (
                        <a href={officesHref} className={inlineLink}>
                          {phoneOffice ? 'odwiedź biuro' : 'Odwiedź jedno z biur'}
                        </a>
                      )}
                      .
                    </p>
                  )}
                </div>

                <div className="rounded-[var(--public-radius-card)] border border-border bg-card p-4 sm:p-7">
                  <PublicSubmissionForm identity={identity} colorScheme={template.dark ? 'dark' : 'light'} />
                </div>
              </div>
            </div>
          </section>
        );
      }
    }
  };

  return (
    <>
      {/* Hero: kim jesteśmy + co zrobić; układ zależy od szablonu (src/lib/publicTheme.ts):
          split - zdjęcie po prawej, split-reverse - zdjęcie po lewej, centered - wyśrodkowany tytuł
          z okrągłym portretem, band - jak split, ale na kolorze przewodnim (`.public-brand-surface` odwraca role kolorów). */}
      <section
        aria-labelledby="hero-title"
        className={cn('bg-card pb-14 pt-10 text-foreground md:pb-20 md:pt-16', heroLayout === 'band' && 'public-brand-surface')}
      >
        <div className={publicContainer}>
          <div
            className={cn(
              publicInner,
              hasPhoto && !centered && 'grid gap-12 lg:items-center lg:gap-16',
              hasPhoto && !centered && (heroLayout === 'split-reverse' ? 'lg:grid-cols-[380px_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_380px]'),
            )}
          >
            <div className={cn(centered && 'mx-auto max-w-3xl text-center')}>
              {hasPhoto && centered && (
                <div className="mx-auto mb-7 h-36 w-36 overflow-hidden rounded-full border-4 border-card bg-brand shadow-[0_6px_18px_hsl(var(--foreground)/0.12)] md:h-44 md:w-44">
                  <img
                    src={identity.photo_url}
                    alt={identity.mp_name}
                    width={800}
                    height={1200}
                    fetchPriority="high"
                    className="h-full w-full object-cover object-top"
                  />
                </div>
              )}
              {kicker && <p className={cn(publicKicker, 'mb-3')}>{kicker}</p>}
              <h1 id="hero-title" className={publicH1}>
                Biuro Poselskie
                {identity.mp_name_genitive && (
                  <>
                    {' '}
                    <span className="text-brand lg:whitespace-nowrap">{identity.mp_name_genitive}</span>
                  </>
                )}
              </h1>
              {hero.lead && (
                <p
                  className={cn(
                    'mt-4 max-w-xl text-[17px] leading-relaxed text-muted-foreground md:text-lg',
                    centered && 'mx-auto',
                  )}
                >
                  {hero.lead}
                </p>
              )}

              {(submitEnabled || officesEnabled) && (
                <div className={cn('mt-7 flex flex-col gap-3 sm:flex-row', centered && 'sm:justify-center')}>
                  {submitEnabled && (
                    <Button asChild variant="brand" className={cn(publicBtn.primary, 'w-full sm:w-auto')}>
                      <a href={submitHref}>
                        {hero.primary_cta}
                        <ArrowRight />
                      </a>
                    </Button>
                  )}
                  {officesEnabled && (
                    <Button asChild variant="outline" className={cn(publicBtn.ghost, 'w-full sm:w-auto')}>
                      <a href={officesHref}>{hero.secondary_cta}</a>
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Wycięte zdjęcie (przezroczyste tło) na panelu w kolorze przewodnim; głowa wychodzi ponad panel. */}
            {hasPhoto && !centered && (
              <figure
                className={cn(
                  'relative mx-auto w-full max-w-[280px] sm:max-w-[320px] lg:max-w-none',
                  heroLayout === 'split-reverse' && 'lg:order-first',
                )}
              >
                <div className="relative aspect-[5/6] overflow-hidden rounded-b-[calc(var(--public-radius-card)*5/3)] lg:aspect-[4/5]">
                  <div
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 top-[18%] overflow-hidden rounded-[calc(var(--public-radius-card)*5/3)] bg-brand"
                  >
                    <img src="/logo.svg" alt="" className="absolute -right-6 bottom-8 h-48 w-auto opacity-[0.12] lg:h-56" />
                  </div>
                  <img
                    src={identity.photo_url}
                    alt={identity.mp_name}
                    width={800}
                    height={1200}
                    fetchPriority="high"
                    className="relative h-full w-full object-cover object-top"
                  />
                </div>
                {identity.mp_name && (
                  <figcaption className="absolute -bottom-4 left-1/2 w-max -translate-x-1/2 rounded-[calc(var(--public-radius-card)*5/6)] border border-border bg-card px-4 py-2.5 text-center shadow-[0_6px_18px_hsl(var(--foreground)/0.10)]">
                    <span className="serif block text-lg leading-tight">{identity.mp_name}</span>
                    <span className="block text-xs text-muted-foreground">{identity.mp_title}</span>
                  </figcaption>
                )}
              </figure>
            )}
          </div>
        </div>
      </section>

      {/* Sekcje w kolejności i widoczności z panelu admina */}
      {enabledSections.map((s, i) => (
        <Fragment key={s.id}>{renderSection(s.id, SECTION_TONES[i % SECTION_TONES.length])}</Fragment>
      ))}
    </>
  );
}
