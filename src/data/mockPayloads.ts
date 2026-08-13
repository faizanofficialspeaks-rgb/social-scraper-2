import { MockPayloadSample } from '../types';

export const MOCK_PAYLOADS: MockPayloadSample[] = [
  {
    id: 'user_feed_graphql',
    name: 'GraphQL User Timeline Feed',
    description: 'Instagram GraphQL response with edge_owner_to_timeline_media containing video & image nodes',
    data: {
      data: {
        user: {
          edge_owner_to_timeline_media: {
            count: 24,
            edges: [
              {
                node: {
                  __typename: 'GraphVideo',
                  id: '3182390123901239012',
                  shortcode: 'C3x9Lp2M1qX',
                  media_type: 2,
                  is_video: true,
                  display_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800',
                  video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
                  video_view_count: 142500,
                  edge_media_preview_like: { count: 18400 },
                  edge_media_to_comment: { count: 342 },
                  taken_at_timestamp: 1723145000,
                  owner: {
                    id: '987654321',
                    username: 'creator_studio',
                    full_name: 'Creator Studio HD',
                    profile_pic_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'
                  },
                  edge_media_to_caption: {
                    edges: [
                      {
                        node: {
                          text: '3 quick tips for viral 4K video editing in 2026! 🚀✨ Save this reel for your next build. #editing #creator #viral'
                        }
                      }
                    ]
                  },
                  video_versions: [
                    { width: 1080, height: 1920, url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
                    { width: 720, height: 1280, url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' }
                  ]
                }
              },
              {
                node: {
                  __typename: 'GraphImage',
                  id: '3182390123901239013',
                  shortcode: 'C3x9K81P0aY',
                  media_type: 1,
                  is_video: false,
                  display_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1000',
                  edge_media_preview_like: { count: 9210 },
                  edge_media_to_comment: { count: 182 },
                  taken_at_timestamp: 1723058600,
                  owner: {
                    id: '987654321',
                    username: 'creator_studio',
                    full_name: 'Creator Studio HD'
                  },
                  edge_media_to_caption: {
                    edges: [
                      { node: { text: 'Golden hour aesthetic shoot in Tokyo. 🇯🇵 Shot on 35mm lens.' } }
                    ]
                  }
                }
              }
            ]
          }
        }
      }
    }
  },
  {
    id: 'reels_tab_payload',
    name: 'Instagram Clips / Reels API',
    description: 'Mobile REST API payload returned when opening user Reels tab (/api/v1/clips/user/)',
    data: {
      items: [
        {
          pk: '3209840192840192840',
          code: 'Cw82L10M9pZ',
          media_type: 2,
          product_type: 'clips',
          caption: {
            text: 'Behind the scenes building a custom UI extension! 🔥 Comment "CODE" for link.'
          },
          user: {
            pk: '1122334455',
            username: 'tech_builder',
            full_name: 'Alex Tech'
          },
          taken_at: 1722900000,
          like_count: 34100,
          comment_count: 890,
          view_count: 289000,
          video_versions: [
            { width: 1080, height: 1920, url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4' }
          ],
          image_versions2: {
            candidates: [
              { width: 1080, height: 1920, url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800' }
            ]
          }
        }
      ]
    }
  },
  {
    id: 'carousel_sidecar_payload',
    name: 'Carousel Sidecar Post',
    description: 'Instagram Multi-slide Carousel post containing image & video children',
    data: {
      items: [
        {
          pk: '3190823091820391823',
          code: 'C5m1K90R2wX',
          media_type: 8,
          caption: {
            text: 'Slide 1 to 5: Step by step guide to mastering CSS Grid & Flexbox in 2026! 🎨'
          },
          user: {
            username: 'design_mentor'
          },
          carousel_media: [
            {
              id: 'sub_1',
              media_type: 1,
              image_versions2: {
                candidates: [
                  { width: 1080, height: 1080, url: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=800' }
                ]
              }
            },
            {
              id: 'sub_2',
              media_type: 1,
              image_versions2: {
                candidates: [
                  { width: 1080, height: 1080, url: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800' }
                ]
              }
            }
          ]
        }
      ]
    }
  }
];
