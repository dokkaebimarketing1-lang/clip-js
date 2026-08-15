'use client';

import Image, {type ImageLoaderProps} from 'next/image';
import {useState} from 'react';
import {FiExternalLink, FiImage, FiMapPin, FiPackage, FiUsers} from 'react-icons/fi';
import type {ProductionAsset} from '@/app/lib/workflow/production-schema';
import type {CharacterSheet, WorkflowState} from '@/app/lib/workflow/schema';

type ReferencePanelProps = {
  readonly workflow: WorkflowState;
  readonly characterPreviewUrls: Readonly<Record<string, string>>;
  readonly onCharacterPreviewError: (characterId: string) => void;
};

const assetTypeDetails: Record<Exclude<ProductionAsset['type'], 'character'>, {
  readonly label: string;
  readonly icon: typeof FiMapPin;
}> = {
  location: {label: '장소', icon: FiMapPin},
  prop: {label: '소품', icon: FiPackage},
  crowd: {label: '군중', icon: FiUsers},
};

const passthroughImageLoader = ({src}: ImageLoaderProps) => src;

const characterStatus = (sheet: CharacterSheet, styleBibleHash?: string) => {
  if (!sheet.referenceImageId) {
    return {label: '기준 이미지 필요', className: 'border-white/10 bg-white/[0.045] text-gray-400'};
  }
  if (styleBibleHash && sheet.referenceStyleHash === styleBibleHash) {
    return {label: '스타일 잠금 완료', className: 'border-emerald-400/20 bg-emerald-400/[0.10] text-emerald-300'};
  }
  return {label: '스타일 검수 필요', className: 'border-amber-400/20 bg-amber-400/[0.10] text-amber-200'};
};

function CharacterReferenceCard({
  sheet,
  index,
  previewUrl,
  styleBibleHash,
  onPreviewError,
}: {
  readonly sheet: CharacterSheet;
  readonly index: number;
  readonly previewUrl?: string;
  readonly styleBibleHash?: string;
  readonly onPreviewError: () => void;
}) {
  const status = characterStatus(sheet, styleBibleHash);
  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-[var(--clip-reference-surface)]">
      <div className="relative aspect-[16/10] border-b border-white/10 bg-black/30">
        {previewUrl ? (
          <Image
            src={previewUrl}
            alt={`${sheet.name} 기준 이미지`}
            fill
            unoptimized
            className="object-cover"
            sizes="286px"
            onError={onPreviewError}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-fuchsia-300">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.035]">
              <FiImage className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-lg border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-black text-white/75 backdrop-blur">
          CHARACTER {String(index + 1).padStart(2, '0')}
        </span>
      </div>
      <div className="p-4">
        <p className="truncate text-sm font-black text-white" title={sheet.name}>{sheet.name}</p>
        <p className="mt-1 truncate text-[11px] text-gray-500">{sheet.breed ?? '캐릭터 기준'}</p>
        <span className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${status.className}`}>{status.label}</span>
      </div>
    </article>
  );
}

function ProductionAssetCard({asset}: {readonly asset: ProductionAsset}) {
  const [imageFailed, setImageFailed] = useState(false);
  if (asset.type === 'character') return null;
  const details = assetTypeDetails[asset.type];
  const AssetIcon = details.icon;
  const hasReferenceUrl = Boolean(asset.referenceUrl);

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
      {hasReferenceUrl && !imageFailed ? (
        <div className="relative aspect-[16/9] border-b border-white/10 bg-black/30">
          <Image
            loader={passthroughImageLoader}
            src={asset.referenceUrl}
            alt={`${asset.tag} ${details.label} 레퍼런스`}
            fill
            unoptimized
            className="object-cover"
            sizes="286px"
            onError={() => setImageFailed(true)}
          />
        </div>
      ) : null}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/[0.08] text-fuchsia-300">
            <AssetIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-fuchsia-500/[0.08] px-2 py-1 text-[10px] font-black text-fuchsia-300">{details.label}</span>
              <p className="min-w-0 flex-1 truncate text-[11px] font-black text-gray-200" title={asset.tag}>{asset.tag}</p>
            </div>
            <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-gray-500">{asset.descriptor}</p>
          </div>
        </div>
        {hasReferenceUrl ? (
          <a
            href={asset.referenceUrl}
            target="_blank"
            rel="noreferrer"
            title={`${asset.tag} 레퍼런스 새 탭에서 열기`}
            className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] font-bold text-gray-400 transition-colors hover:border-fuchsia-400/30 hover:text-fuchsia-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            <FiExternalLink className="shrink-0" aria-hidden="true" />
            <span className="truncate">{imageFailed ? '참조 링크 열기' : '원본 레퍼런스 열기'}</span>
          </a>
        ) : (
          <span className="mt-3 inline-flex rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-bold text-gray-600">참조 URL 없음</span>
        )}
      </div>
    </article>
  );
}

export default function ReferencePanel({workflow, characterPreviewUrls, onCharacterPreviewError}: ReferencePanelProps) {
  const characterSheets = workflow.characterSheets ?? [];
  const productionAssets = workflow.production.assets.filter((asset) => asset.type !== 'character');

  if (characterSheets.length === 0 && productionAssets.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.035] p-6 text-center">
        <div>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/[0.08] text-fuchsia-300">
            <FiImage className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-sm font-black text-white">아직 기준 이미지가 없어요</h2>
          <p className="mt-2 text-[11px] leading-5 text-gray-500">2단계 캐릭터·스타일에서 캐릭터 기준을 만들면 이곳에 레퍼런스가 모입니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      {characterSheets.length > 0 ? (
        <section aria-labelledby="character-references-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black tracking-[0.16em] text-fuchsia-300">CHARACTERS</p>
              <h2 id="character-references-title" className="mt-1 text-sm font-black text-white">캐릭터 기준</h2>
            </div>
            <span className="clip-number rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-bold text-gray-500">{characterSheets.length}명</span>
          </div>
          <div className="space-y-3">
            {characterSheets.map((sheet, index) => {
              const characterId = sheet.id ?? sheet.name;
              return (
                <CharacterReferenceCard
                  key={characterId}
                  sheet={sheet}
                  index={index}
                  previewUrl={characterPreviewUrls[characterId]}
                  styleBibleHash={workflow.styleBibleHash}
                  onPreviewError={() => onCharacterPreviewError(characterId)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {productionAssets.length > 0 ? (
        <section aria-labelledby="production-assets-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black tracking-[0.16em] text-fuchsia-300">PRODUCTION ASSETS</p>
              <h2 id="production-assets-title" className="mt-1 text-sm font-black text-white">장소·소품</h2>
            </div>
            <span className="clip-number rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-bold text-gray-500">{productionAssets.length}개</span>
          </div>
          <div className="space-y-3">{productionAssets.map((asset) => <ProductionAssetCard key={asset.id} asset={asset} />)}</div>
        </section>
      ) : null}
    </div>
  );
}
