require 'json'
package_json = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|

  s.name           = 'RNNtpSync'
  s.version        = package_json['version']
  s.summary        = package_json['description']
  s.homepage       = package_json['homepage']
  s.license        = package_json['license']
  s.author         = 'Ruanitto'
  s.platform       = :ios, '9.0'
  s.source         = { :git => package_json['repository']['url'], :tag => "v#{s.version}" }
  s.source_files   = 'ios/**/*.{h,m,mm}'
  s.framework      = 'QuartzCore'
  s.dependency 'React-Core'
end
